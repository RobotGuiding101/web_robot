"""maps_point/camera.py — Intel D455 pipeline + depth-only plane fit.

sample_plane_region_grow() locates and fits the marked object's plane
using depth alone (no color image, no per-point optical flow) — see its
own docstring. Replaced the earlier cv2.fillPoly + LK-point-tracking
approach on 2026-07-28 after that let a tracked corner drift onto the
background with nothing to geometrically check it against.

Architecture: Single Capture Thread pattern
- ONE dedicated thread runs the capture loop (pipe.wait_for_frames())
- Shared buffers (_color_buf, _depth_buf, _accel_buf) are written by capture thread
- Multiple consumers can read from buffers safely via thread-safe getters
- No race conditions: only capture thread accesses hardware directly
"""
import threading
from time import sleep, time as _time

import cv2
import numpy as np

from .config import CAM_SERIAL, MIN_DEPTH_MM, DEPTH_N_FRAMES, DEPTH_ROI
from .logs import log

try:
    import pyrealsense2 as rs
    HAS_RS = True
except ImportError:
    HAS_RS = False


def list_devices(retries=3, delay=0.8):
    for attempt in range(retries):
        out = _list_devices_rs()
        if out:
            return out
        if attempt < retries - 1:
            sleep(delay)
    return []


def _list_devices_rs():
    if not HAS_RS:
        return []
    out = []
    try:
        ctx = rs.context()
        for d in ctx.query_devices():
            row = {}
            for key, name in ((rs.camera_info.serial_number, "serial"),
                              (rs.camera_info.name, "name"),
                              (rs.camera_info.product_line, "product"),
                              (rs.camera_info.firmware_version, "firmware"),
                              (rs.camera_info.usb_type_descriptor, "usb")):
                try:
                    row[name] = d.get_info(key)
                except Exception:
                    row[name] = None
            if row.get("serial"):
                out.append(row)
    except Exception as e:
        log(f"  [Cam] list_devices failed: {e}")
    return out


RECONNECT_AFTER = 3

# Serializes pipeline bring-up across ALL Camera instances. Two D455s that
# call pipe.start() at the same moment fight over the USB stack and one fails
# with "Couldn't resolve requests" / "xioctl(VIDIOC_S_FMT) failed ... Device or
# resource busy", after which the losing pipeline never recovers. Holding this
# for the whole configure+start(+first frames) window makes bring-up atomic.
_START_LOCK = threading.Lock()


def _is_frame_timeout(exc: Exception) -> bool:
    return "didn't arrive" in str(exc) or "Frame didn't arrive" in str(exc)


class Camera:
    def __init__(self):
        self.pipe       = None
        self.intrinsics = None
        self.w = 848; self.h = 480
        self._running   = False
        self._align     = None
        self.serial     = CAM_SERIAL
        
        # ── Shared buffers (written by capture thread, read by anyone) ──
        self._depth_buf: list = []
        self._depth_lock = threading.Lock()
        self._color_buf  = None
        self._color_lock = threading.Lock()
        self._accel_buf  = None
        self._accel_lock = threading.Lock()
        self._has_imu     = False
        
        # ── Capture thread control ──
        self._capture_thread = None
        self._capture_stop_event = threading.Event()
        self._frame_count = 0
        self._err_streak = 0
        # Rolling-median cache, keyed by the frame counter it was built from.
        self._stacked_frame = None
        self._stacked_key = None

        # ── SDK colored point cloud (RealSense post-processing + rs.pointcloud) ──
        self._pc          = None
        self._dec         = None
        self._spat        = None
        self._temp        = None
        self._hole        = None
        self._cloud_buf   = None       # (positions_m float32[N,3], colors_rgb uint8[N,3])
        self._cloud_lock  = threading.Lock()
        self._cloud_every = 12         # rebuild cloud every N captured frames

    def start(self, retries=3, retry_delay=1.0) -> bool:
        if not HAS_RS:
            log("  pyrealsense2 not installed"); return False
        with _START_LOCK:
            return self._start_locked(retries=retries, retry_delay=retry_delay)

    def set_inter_cam_sync(self, mode: int) -> bool:
        """Set D455 Inter Cam Sync Mode on the depth sensor: 0=off, 1=master,
        2=slave. Two D455s only expose aligned timestamps when one is master
        and the other is a slave wired to it — matching point clouds from
        unsynced cameras drift and shake. Best-effort: true HW sync also needs
        the physical sync cable; without it this is a no-op the device accepts
        anyway. Must be called BEFORE pipe.start()."""
        if not HAS_RS or not self.serial:
            return False
        try:
            ctx = rs.context()
            for d in ctx.query_devices():
                if d.get_info(rs.camera_info.serial_number) != self.serial:
                    continue
                for s in d.sensors:
                    if s.supports(rs.option.inter_cam_sync_mode):
                        s.set_option(rs.option.inter_cam_sync_mode, float(mode))
                        log(f"  [Cam] {self.serial} inter_cam_sync_mode={mode}")
                        return True
        except Exception as e:
            log(f"  [Cam] inter_cam_sync set failed: {e}")
        return False

    def _start_locked(self, retries=3, retry_delay=1.0) -> bool:
        if self._running:
            log("  [Cam] already running; start() is a no-op")
            return True
        if self._capture_thread and self._capture_thread.is_alive():
            log("  [Cam] capture thread still running, stopping it")
            self._capture_stop_event.set()
            self._capture_thread.join(timeout=2.0)
        cfg = rs.config()
        if self.serial:
            cfg.enable_device(self.serial)
        cfg.enable_stream(rs.stream.depth, self.w, self.h, rs.format.z16, 30)
        cfg.enable_stream(rs.stream.color, self.w, self.h, rs.format.bgr8, 30)
        imu_cfg = rs.config()
        if self.serial:
            imu_cfg.enable_device(self.serial)
        imu_cfg.enable_stream(rs.stream.depth, self.w, self.h, rs.format.z16, 30)
        imu_cfg.enable_stream(rs.stream.color, self.w, self.h, rs.format.bgr8, 30)
        imu_cfg.enable_stream(rs.stream.accel)
        # Inter-cam sync is set by the caller (main.py) before start(), not
        # here: a per-camera env value would otherwise overwrite the role the
        # caller assigned once start() runs for the second camera.

        for attempt in range(retries):
            try:
                self.pipe   = rs.pipeline()
                prof        = self.pipe.start(imu_cfg)
                self._has_imu = True
                break
            except Exception as e:
                log(f"  [Cam] attempt {attempt+1}/{retries} failed: {e}")
                self._has_imu = False
                if self.pipe:
                    try:
                        self.pipe.stop()
                    except Exception:
                        pass
                    self.pipe = None
                if attempt < retries - 1:
                    sleep(retry_delay)
                    continue
                try:
                    self.pipe = rs.pipeline()
                    prof      = self.pipe.start(cfg)
                except Exception as e2:
                    log(f"  [Cam] FAILED  {e2}"); return False
        try:
            self._align = rs.align(rs.stream.color)
            ci          = prof.get_stream(rs.stream.color).as_video_stream_profile().get_intrinsics()
            self.intrinsics = {"fx": ci.fx, "fy": ci.fy, "cx": ci.ppx, "cy": ci.ppy}
            self.w = ci.width; self.h = ci.height
            self._init_cloud_pipeline()
            self._running = True
            for _ in range(30):
                self.pipe.wait_for_frames()
            if self._running:
                self._start_capture_thread()
                sleep(0.2)  # Give capture thread time to initialize
            log(f"  [Cam] started  fx={ci.fx:.1f}  fy={ci.fy:.1f}  cx={ci.ppx:.1f}  cy={ci.ppy:.1f}"
                f"  imu={self._has_imu}")
            return True
        except Exception as e:
            self._running = False
            self._capture_stop_event.set()
            if self._capture_thread and self._capture_thread.is_alive():
                self._capture_thread.join(timeout=1.0)
            if self.pipe:
                try:
                    self.pipe.stop()
                except Exception:
                    pass
                self.pipe = None
            log(f"  [Cam] FAILED  {e}")
            if _is_frame_timeout(e) and not getattr(self, "_reset_done", False):
                self._reset_done = True
                log("  [Cam] depth stream hung — issuing hardware reset and retrying")
                if self._hardware_reset():
                    self._reset_done = False
                    return self._start_locked(retries=retries, retry_delay=retry_delay)
            return False

    def _hardware_reset(self) -> bool:
        """Power-cycle the D455 over USB. The depth (Stereo Module) stream
        occasionally wedges — pipe.start() succeeds but no depth frame ever
        arrives ("Frame didn't arrive within 5000") until the device is
        hardware-reset. The RGB stream is unaffected, so a reset is the only
        software-side recovery short of unplugging the camera."""
        if not HAS_RS or not self.serial:
            return False
        try:
            ctx = rs.context()
            dev = next((d for d in ctx.query_devices()
                        if d.get_info(rs.camera_info.serial_number) == self.serial), None)
            if dev is None:
                log("  [Cam] hardware reset: device not found")
                return False
            dev.hardware_reset()
        except Exception as e:
            log(f"  [Cam] hardware reset failed: {e}")
            return False
        for _ in range(20):
            sleep(0.5)
            try:
                ctx = rs.context()
                if any(d.get_info(rs.camera_info.serial_number) == self.serial
                       for d in ctx.query_devices()):
                    sleep(1.0)
                    return True
            except Exception:
                pass
        log("  [Cam] hardware reset: device did not re-enumerate")
        return False

    def stop(self):
        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_stop_event.set()
            self._capture_thread.join(timeout=2.0)
        if self.pipe and self._running:
            self.pipe.stop()
            self._running = False
            self.pipe = None

    def set_serial(self, serial: str):
        self.serial = (serial or "").strip()

    def _start_capture_thread(self):
        self._capture_stop_event.clear()
        self._capture_thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._capture_thread.start()

    def _init_cloud_pipeline(self):
        """Set up the SDK point-cloud path: decimate -> spatial -> temporal ->
        hole-filling, then rs.pointcloud mapped to the (aligned) color frame.
        Failure is non-fatal: the app keeps running with the cloud disabled."""
        if not HAS_RS:
            return
        try:
            dec = rs.decimation_filter()
            dec.set_option(rs.option.filter_magnitude, 3)
            self._dec = dec
            self._spat = rs.spatial_filter()
            self._temp = rs.temporal_filter()
            self._hole = rs.hole_filling_filter()
            self._pc = rs.pointcloud()
            with self._cloud_lock:
                self._cloud_buf = None
            log("  [Cam] point cloud: SDK pipeline ready "
                "(decimation x3 + spatial + temporal + hole-filling)")
        except Exception as e:
            self._pc = None
            log(f"  [Cam] point cloud init failed: {e}")

    def _build_cloud(self, df, cf):
        """Run the filter chain + rs.pointcloud on one aligned frame pair and
        stash the colored cloud for get_latest_pointcloud()."""
        try:
            d = self._dec.process(df)
            d = self._spat.process(d)
            d = self._temp.process(d)
            d = self._hole.process(d)
            self._pc.map_to(cf)
            pts = self._pc.calculate(d)
            verts = np.asanyarray(pts.get_vertices())
            if verts.size == 0:
                return
            xyz = np.ascontiguousarray(verts.view(np.float32).reshape(-1, 3))
            tex = np.asanyarray(pts.get_texture_coordinates()).view(np.float32).reshape(-1, 2)
            valid = xyz[:, 2] > 0.05
            if not valid.any():
                return
            xyz = xyz[valid]
            tex = tex[valid]
            cimg = np.asanyarray(cf.get_data())
            h, w = cimg.shape[:2]
            u = np.clip((tex[:, 0] * w).astype(np.int32), 0, w - 1)
            v = np.clip((tex[:, 1] * h).astype(np.int32), 0, h - 1)
            rgb = np.ascontiguousarray(cimg[v, u][:, ::-1])
            with self._cloud_lock:
                self._cloud_buf = (xyz, rgb)
        except Exception as e:
            log(f"  [Cam] cloud build failed: {e}")

    def _capture_loop(self):
        while not self._capture_stop_event.is_set():
            try:
                if not self._running or self.pipe is None:
                    sleep(0.1)
                    continue
                frameset = self.pipe.wait_for_frames()
                if self._has_imu:
                    accel_f = frameset.first_or_default(rs.stream.accel)
                    if accel_f:
                        v = accel_f.as_motion_frame().get_motion_data()
                        with self._accel_lock:
                            self._accel_buf = (v.x, v.y, v.z)
                frames = self._align.process(frameset)
                df = frames.get_depth_frame()
                cf = frames.get_color_frame()
                if df:
                    arr = np.asarray(df.get_data()).copy()
                    with self._depth_lock:
                        self._depth_buf.append(arr)
                        if len(self._depth_buf) > DEPTH_N_FRAMES:
                            self._depth_buf.pop(0)
                if cf:
                    with self._color_lock:
                        self._color_buf = np.asanyarray(cf.get_data()).copy()
                if (self._pc is not None and df and cf and
                        (self._frame_count % self._cloud_every == 0)):
                    self._build_cloud(df, cf)
                self._frame_count += 1
                self._err_streak = 0
            except Exception as e:
                if self._capture_stop_event.is_set():
                    break
                if "before start" in str(e):
                    log(f"  [Cam] capture thread: pipeline not started, stopping")
                    break
                self._err_streak += 1
                log(f"  [Cam] capture error ({self._err_streak}): {e}")
                if self._err_streak >= RECONNECT_AFTER:
                    self._err_streak = 0
                    if self._capture_stop_event.is_set():
                        break
                    if self._reopen_pipeline():
                        log("  [Cam] pipeline reopened after USB drop")
                    else:
                        log("  [Cam] pipeline reopen failed; retrying")
                        sleep(2.0)
                sleep(0.01)

    def _reopen_pipeline(self) -> bool:
        """Rebuild the RealSense pipeline after repeated frame timeouts.

        Runs inside the capture thread, so it must NOT call stop()/start()
        (those join/restart this very thread); it only swaps rs.pipeline in
        place and returns True once frames flow again.
        """
        with _START_LOCK:
            return self._reopen_pipeline_locked()

    def _reopen_pipeline_locked(self) -> bool:
        try:
            if self.pipe is not None:
                self.pipe.stop()
        except Exception:
            pass
        self.pipe = None

        def _make_cfg(with_imu: bool):
            c = rs.config()
            if self.serial:
                c.enable_device(self.serial)
            c.enable_stream(rs.stream.depth, self.w, self.h, rs.format.z16, 30)
            c.enable_stream(rs.stream.color, self.w, self.h, rs.format.bgr8, 30)
            if with_imu:
                c.enable_stream(rs.stream.accel)
            return c

        new_pipe, prof = None, None
        for with_imu in (True, False):
            pipe = rs.pipeline()
            try:
                prof = pipe.start(_make_cfg(with_imu))
                new_pipe = pipe
                self._has_imu = with_imu
                break
            except Exception:
                try:
                    pipe.stop()
                except Exception:
                    pass
        if new_pipe is None:
            return False

        self.pipe = new_pipe
        try:
            self._align = rs.align(rs.stream.color)
            ci = prof.get_stream(rs.stream.color).as_video_stream_profile().get_intrinsics()
            self.intrinsics = {"fx": ci.fx, "fy": ci.fy, "cx": ci.ppx, "cy": ci.ppy}
            self.w = ci.width
            self.h = ci.height
            self._init_cloud_pipeline()
            for _ in range(15):
                self.pipe.wait_for_frames()
        except Exception:
            try:
                self.pipe.stop()
            except Exception:
                pass
            self.pipe = None
            return False
        return True

    def get_latest_accel(self):
        """Most recent accelerometer sample (ax,ay,az in m/s^2, D455 IMU
        axes — raw, no extrinsic correction to the optical frame), or None
        if the IMU isn't streaming. Thread-safe read, same pattern as
        get_latest_color()."""
        with self._accel_lock:
            return self._accel_buf

    def get_latest_frame(self):
        """Get latest color and depth frames from shared buffers.
        
        Returns (color_frame, depth_frame) as numpy arrays, or (None, None)
        if no frames available yet. Thread-safe — reads from buffers
        written by capture thread.
        """
        with self._color_lock:
            color = self._color_buf.copy() if self._color_buf is not None else None
        with self._depth_lock:
            depth = self._depth_buf[-1].copy() if self._depth_buf else None
        return color, depth

    def get_latest_frames_ref(self):
        """Zero-copy variant of get_latest_frame() for read-only consumers
        that encode/consume the frame immediately. The capture thread only
        ever REPLACES buffer references (never mutates in place), so the
        returned arrays are stable snapshots — callers must not mutate them.
        """
        with self._color_lock:
            color = self._color_buf
        with self._depth_lock:
            depth = self._depth_buf[-1] if self._depth_buf else None
        return color, depth

    def get_latest_pointcloud(self):
        """Most recent SDK colored cloud as (positions_m[N,3] float32,
        colors_rgb[N,3] uint8), or (None, None) before the first build.

        The capture thread only ever replaces the tuple, so the returned
        arrays are stable read-only snapshots."""
        with self._cloud_lock:
            if self._cloud_buf is None:
                return None, None
            return self._cloud_buf

    def get_latest_color(self, max_wait: float = 2.0):
        """Most recent color frame, written by capture thread.
        
        Does NOT call pipe.wait_for_frames() itself, so it's safe to call
        from any thread. Waits briefly for the capture thread to have
        produced at least one frame; returns None if it times out.
        """
        deadline = _time() + max_wait
        while _time() < deadline:
            with self._color_lock:
                if self._color_buf is not None:
                    return self._color_buf
            sleep(0.02)
        return None

    def _wait_depth_buf(self, min_frames: int = 3) -> list:
        """Wait for the capture thread's rolling buffer to fill.
        
        No longer falls back to direct capture — the capture thread
        runs continuously when camera is started.
        """
        for _ in range(30):
            with self._depth_lock:
                buf = list(self._depth_buf)
            if len(buf) >= min_frames:
                return buf
            sleep(0.03)
        return buf

    def sample_depth(self, u: int, v: int) -> float:
        """Trimmed-mean depth over a DEPTH_ROI square around (u,v). Ported
        from pick_45degree.py's Camera.sample_depth() — used for the
        pre-align 'move to center' step (rough approach position, not a
        precision pick)."""
        if not self._running: return 0.0
        buf = self._wait_depth_buf()
        if not buf: return 0.0
        r  = DEPTH_ROI
        x0 = max(0, u - r); x1 = min(self.w - 1, u + r)
        y0 = max(0, v - r); y1 = min(self.h - 1, v + r)
        vals = []
        for arr in buf:
            patch = arr[y0:y1, x0:x1].astype(float)
            m = patch[patch > MIN_DEPTH_MM * 0.8]
            if len(m): vals.extend(m.tolist())
        if not vals: return 0.0
        vals.sort()
        trim = vals[len(vals) // 4: 3 * len(vals) // 4]
        return float(np.mean(trim)) if trim else 0.0

    def sample_plane_region_grow(self, seed_x: int, seed_y: int, tol_mm: float,
                                  prev_bbox: tuple = None, expected_tilt_deg: float = None):
        """Depth-ONLY plane fit + region tracking — no color image, no
        per-point optical flow. Replaces the old fixed-4-corner /
        cv2.fillPoly + LK-tracking approach (2026-07-28): that let a
        tracked corner drift onto a visually-similar-but-geometrically-
        wrong feature (e.g. the table behind the box) with nothing to
        check it against, which is exactly what happened on hardware
        2026-07-27i (rmse jumped from ~0.65mm to 4.38mm in one step).

        Method: fit a rough plane from a small seed patch around
        (seed_x,seed_y), then — within a search window around prev_bbox
        (or the seed if this is the first call) — include every pixel
        whose ACTUAL depth matches what THAT plane predicts there within
        tol_mm, restricted to the connected component touching the seed
        (cv2.connectedComponentsWithStats). A background pixel can't get
        pulled in by visual similarity here — it simply won't lie on the
        object's plane. If the seed itself isn't in any consistent
        component but a sizeable one exists nearby (2026-07-28g — the seed
        landed just past the object's true edge), snaps to the NEAREST
        such component instead of failing outright. The final plane fit
        is then redone precisely over the full grown region (same PCA as
        before).

        expected_tilt_deg, if given, sanity-checks a SNAPPED result (not
        one where the seed matched directly) against the last known tilt
        — rejects it if the snapped component's tilt is wildly different,
        since "nearest consistent component" can otherwise latch onto an
        unrelated flat surface (e.g. the table/backdrop) that happens to
        sit near the seed but isn't the tracked object at all.

        Returns (nx, ny, nz, tilt_deg, rmse_mm, depth_range_mm, roll_deg,
        quad_px) in CAMERA frame, or None if no trustworthy match was
        found (object likely left frame — caller must abort, not guess).
        roll_deg is the grown region's apparent rotation in the image
        (from cv2.minAreaRect, normalized into (-45,45] since a
        rectangle's orientation is only meaningful mod 90°) — used by
        align's Rz correction phase. quad_px is a 4-point rotated
        bounding box of the grown region (cv2.boxPoints), kept as the
        "points" list for drawing/recenter-guard/goto-centroid
        compatibility with the rest of the app.
        """
        if not self._running or self.intrinsics is None:
            return None
        buf = self._wait_depth_buf()
        if not buf:
            return None
        # Rolling median over the whole frame costs ~256ms for 30x848x480 on the
        # Pi — far more than the ~30ms tracking period, so recomputing it on
        # every call pinned one core permanently. The capture thread only
        # advances _frame_count when a new frame lands, so keying the result on
        # it reuses the identical median across calls that see no new frame.
        key = self._frame_count
        if key != self._stacked_key:
            self._stacked_frame = np.median(np.stack(buf), axis=0).astype(float)
            self._stacked_key = key
        full = self._stacked_frame
        fx = self.intrinsics["fx"]; fy = self.intrinsics["fy"]
        cx = self.intrinsics["cx"]; cy = self.intrinsics["cy"]

        # The seed is the marked centroid, which can land on a depth hole (a
        # specular/dark dot) or its noisy edge — the seed-patch plane fit then
        # comes out garbage and connectedComponents can't seed a component
        # there, so align fails every cycle (observed 2026-09-25). Re-seat the
        # seed on the centroid of the largest solid-depth component near it.
        rr = 30
        sy_a = max(0, int(seed_y) - rr); sy_b = min(self.h - 1, int(seed_y) + rr)
        sx_a = max(0, int(seed_x) - rr); sx_b = min(self.w - 1, int(seed_x) + rr)
        sub_valid = (full[sy_a:sy_b, sx_a:sx_b] > MIN_DEPTH_MM * 0.8).astype(np.uint8)
        if sub_valid.sum() >= 50:
            n_lbl, _, sts, cents = cv2.connectedComponentsWithStats(sub_valid)
            if n_lbl > 1:
                k = int(np.argmax(sts[1:, cv2.CC_STAT_AREA])) + 1
                n_seed_x = int(cents[k][0] + sx_a); n_seed_y = int(cents[k][1] + sy_a)
                if (n_seed_x, n_seed_y) != (int(seed_x), int(seed_y)):
                    log(f"  [Cam] region-grow: seed re-seated to solid region "
                        f"({int(seed_x)},{int(seed_y)}) -> ({n_seed_x},{n_seed_y})")
                    seed_x, seed_y = n_seed_x, n_seed_y

        # ── seed-patch plane estimate ───────────────────────────────────
        r = DEPTH_ROI
        sx0 = max(0, seed_x - r); sx1 = min(self.w - 1, seed_x + r)
        sy0 = max(0, seed_y - r); sy1 = min(self.h - 1, seed_y + r)
        if sx1 <= sx0 or sy1 <= sy0:
            log(f"  [Cam] region-grow: seed patch window degenerate at ({seed_x},{seed_y})")
            return None
        seed_patch = full[sy0:sy1, sx0:sx1]
        seed_valid = seed_patch > MIN_DEPTH_MM * 0.8
        if seed_valid.sum() < 10:
            log(f"  [Cam] region-grow: seed patch has too little valid depth "
                f"({int(seed_valid.sum())} px) at ({seed_x},{seed_y})")
            return None
        vv0, uu0 = np.mgrid[sy0:sy1, sx0:sx1]
        d0 = seed_patch[seed_valid]
        pts0 = np.stack([(uu0[seed_valid] - cx) * d0 / fx,
                          (vv0[seed_valid] - cy) * d0 / fy, d0], axis=1)
        centroid0 = pts0.mean(axis=0)
        cov0          = np.cov((pts0 - centroid0).T)
        evals0, evecs0 = np.linalg.eigh(cov0)
        normal0       = evecs0[:, 0]
        if normal0[2] > 0:
            normal0 = -normal0
        planeD0 = float(normal0 @ centroid0)

        # ── search window: around the last grown region, or the seed ───
        if prev_bbox is not None:
            bx0, by0, bx1, by1 = prev_bbox
            mw = (bx1 - bx0) * 0.4 + 20; mh = (by1 - by0) * 0.4 + 20
            wx0 = max(0, int(bx0 - mw)); wx1 = min(self.w - 1, int(bx1 + mw))
            wy0 = max(0, int(by0 - mh)); wy1 = min(self.h - 1, int(by1 + mh))
        else:
            wx0 = max(0, seed_x - 200); wx1 = min(self.w - 1, seed_x + 200)
            wy0 = max(0, seed_y - 200); wy1 = min(self.h - 1, seed_y + 200)
        if wx1 <= wx0 or wy1 <= wy0:
            log(f"  [Cam] region-grow: search window degenerate around ({seed_x},{seed_y})")
            return None

        win = full[wy0:wy1, wx0:wx1]
        vvw, uuw = np.mgrid[wy0:wy1, wx0:wx1]
        valid_win = win > MIN_DEPTH_MM * 0.8
        denom = normal0[0] * (uuw - cx) / fx + normal0[1] * (vvw - cy) / fy + normal0[2]
        with np.errstate(divide="ignore", invalid="ignore"):
            predicted = np.where(np.abs(denom) > 1e-6, planeD0 / denom, np.inf)
        consistent = valid_win & (np.abs(win - predicted) < tol_mm)
        if consistent.sum() < 20:
            log(f"  [Cam] region-grow: only {int(consistent.sum())} consistent px in "
                f"window ({wx0},{wy0})-({wx1},{wy1}), seed=({seed_x},{seed_y})")
            return None

        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
            consistent.astype(np.uint8))
        seed_lx = min(max(seed_x - wx0, 0), labels.shape[1] - 1)
        seed_ly = min(max(seed_y - wy0, 0), labels.shape[0] - 1)
        seed_label = labels[seed_ly, seed_lx]
        snapped = False
        if seed_label == 0:
            # The seed pixel itself isn't consistent, but plenty of
            # consistent area may still exist right next to it (e.g. the
            # seed landed just past the object's true edge) — on hardware
            # 2026-07-28g this happened repeatedly at the same trajectory
            # point even after the widened-window retry (2026-07-28e):
            # tens of thousands of consistent px existed in the window,
            # just not touching the exact seed pixel. Snap to the NEAREST
            # reasonably-sized component instead of failing outright —
            # bounded by a distance cap so this can't latch onto an
            # unrelated surface elsewhere in the window.
            best_label, best_dist = 0, None
            for lbl in range(1, num_labels):
                if stats[lbl, cv2.CC_STAT_AREA] < 20:
                    continue
                clx, cly = centroids[lbl]
                dist = ((clx - seed_lx) ** 2 + (cly - seed_ly) ** 2) ** 0.5
                if best_dist is None or dist < best_dist:
                    best_label, best_dist = lbl, dist
            max_snap_dist = max(wx1 - wx0, wy1 - wy0) * 0.5
            if best_label == 0 or best_dist > max_snap_dist:
                log(f"  [Cam] region-grow: seed ({seed_x},{seed_y}) itself isn't in any "
                    f"consistent component, and none nearby was close enough to snap to "
                    f"({int(consistent.sum())} consistent px existed in the window)")
                return None
            log(f"  [Cam] region-grow: seed ({seed_x},{seed_y}) missed the object by "
                f"~{best_dist:.0f}px — snapped to the nearest consistent component instead")
            seed_label = best_label
            snapped = True
        final_mask = labels == seed_label
        if final_mask.sum() < 20:
            log(f"  [Cam] region-grow: seed's connected component too small "
                f"({int(final_mask.sum())} px)")
            return None

        # ── precise PCA fit over the full grown region ──────────────────
        d = win[final_mask]
        X = (uuw[final_mask] - cx) * d / fx
        Y = (vvw[final_mask] - cy) * d / fy
        pts = np.stack([X, Y, d], axis=1)
        centroid     = pts.mean(axis=0)
        cov          = np.cov((pts - centroid).T)
        evals, evecs = np.linalg.eigh(cov)
        normal       = evecs[:, 0]
        if normal[2] > 0:
            normal = -normal
        tilt_deg = float(np.degrees(np.arccos(np.clip(-normal[2], -1.0, 1.0))))
        rmse_mm  = float(np.sqrt(max(evals[0], 0.0)))
        depth_range_mm = float(d.max() - d.min())

        if snapped and expected_tilt_deg is not None and abs(tilt_deg - expected_tilt_deg) > 15.0:
            # "Nearest consistent component" is a reasonable guess when the
            # seed just barely missed the object's true edge, but nothing
            # stops it from being an unrelated flat surface (table,
            # backdrop) that happens to sit near the seed instead — this
            # bit us in a synthetic test (snapped onto a flat backdrop
            # facing the camera dead-on, reporting tilt=90° instead of the
            # object's real ~few-degree tilt). A snap whose tilt is wildly
            # different from what we last measured is more likely a wrong
            # surface than a real, sudden 15°+ jump — reject it rather
            # than silently reporting a bogus plane.
            log(f"  [Cam] region-grow: snapped component's tilt ({tilt_deg:.1f}°) is "
                f"implausibly far from the last known tilt ({expected_tilt_deg:.1f}°) — "
                f"rejecting as a likely wrong-surface snap")
            return None

        ys, xs = np.where(final_mask)
        xs_full = (xs + wx0).astype(np.float32); ys_full = (ys + wy0).astype(np.float32)
        rect = cv2.minAreaRect(np.stack([xs_full, ys_full], axis=1))
        box  = cv2.boxPoints(rect)
        quad_px = [(int(round(px)), int(round(py))) for px, py in box]
        # normalize into (-45,45] — a rectangle's orientation only means
        # anything mod 90°, so raw cv2 angle conventions (which vary by
        # OpenCV version) aren't worth chasing exactly; this just needs to
        # be a continuous, sign-determinable "how far from axis-aligned"
        # scalar for the probe-then-converge Rz phase to drive toward 0.
        roll_deg = float(((rect[-1] + 45) % 90) - 45)

        return (float(normal[0]), float(normal[1]), float(normal[2]),
                tilt_deg, rmse_mm, depth_range_mm, roll_deg, quad_px)
