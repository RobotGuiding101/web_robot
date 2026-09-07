"""maps_point/camera.py — Intel D455 pipeline + depth-only plane fit.

sample_plane_region_grow() locates and fits the marked object's plane
using depth alone (no color image, no per-point optical flow) — see its
own docstring. Replaced the earlier cv2.fillPoly + LK-point-tracking
approach on 2026-07-28 after that let a tracked corner drift onto the
background with nothing to geometrically check it against.
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


class Camera:
    def __init__(self):
        self.pipe       = None
        self.intrinsics = None
        self.w = 848; self.h = 480
        self._running   = False
        self._align     = None
        self._depth_buf: list = []
        self._depth_lock = threading.Lock()
        # latest COLOR frame, written only by get_frames() (called by the
        # MJPEG generator loop) — see get_latest_color()'s docstring for
        # why this exists: pyrealsense2's pipeline isn't safe to pull from
        # concurrently, so anything that needs a color frame (the align
        # point tracker) must read this instead of calling get_frames()
        # itself from a second thread.
        self._color_buf  = None
        self._color_lock = threading.Lock()
        # latest accelerometer sample (gravity vector, m/s^2, in the D455's
        # own IMU axes) — an independent, physically-grounded check of how
        # the camera is actually oriented, separate from both the vision
        # PCA plane fit AND the robot controller's own reported Rx/Ry/Rz
        # (added 2026-07-27g at the user's suggestion, to help diagnose
        # "which way is it really tilting" questions that pixel-drift
        # analysis alone couldn't answer confidently). No IMU-to-optical-
        # frame extrinsic calibration is applied here — this is the raw
        # 3-axis reading, not a derived "tilt from vertical" angle; don't
        # invent a precise interpretation of it that isn't verified.
        self._accel_buf  = None
        self._accel_lock = threading.Lock()
        self._has_imu     = False

    def start(self) -> bool:
        if not HAS_RS:
            log("  pyrealsense2 not installed"); return False
        cfg = rs.config()
        if CAM_SERIAL:
            cfg.enable_device(CAM_SERIAL)
        cfg.enable_stream(rs.stream.depth, self.w, self.h, rs.format.z16, 30)
        cfg.enable_stream(rs.stream.color, self.w, self.h, rs.format.bgr8, 30)
        # D455 has an onboard IMU (accel) separate from the depth/color
        # sensors. enable_stream() itself won't raise for a stream the
        # device doesn't have — the failure only shows up at pipe.start()
        # — so try WITH accel first and fall back to depth+color only if
        # that fails, rather than let an optional IMU take down the whole
        # camera.
        imu_cfg = rs.config()
        if CAM_SERIAL:
            imu_cfg.enable_device(CAM_SERIAL)
        imu_cfg.enable_stream(rs.stream.depth, self.w, self.h, rs.format.z16, 30)
        imu_cfg.enable_stream(rs.stream.color, self.w, self.h, rs.format.bgr8, 30)
        imu_cfg.enable_stream(rs.stream.accel)
        try:
            self.pipe   = rs.pipeline()
            prof        = self.pipe.start(imu_cfg)
            self._has_imu = True
        except Exception as e:
            log(f"  [Cam] accel stream unavailable, continuing without it  {e}")
            self._has_imu = False
            # Clean up the failed pipeline before retrying — without this
            # the old pipeline still holds the device lock, causing the
            # retry to hit "Device or resource busy" (errno=16).
            try:
                self.pipe.stop()
            except Exception:
                pass
            self.pipe = None
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
            self._running = True
            for _ in range(30):
                self.pipe.wait_for_frames()
            log(f"  [Cam] started  fx={ci.fx:.1f}  fy={ci.fy:.1f}  cx={ci.ppx:.1f}  cy={ci.ppy:.1f}"
                f"  imu={self._has_imu}")
            return True
        except Exception as e:
            log(f"  [Cam] FAILED  {e}"); return False

    def stop(self):
        if self.pipe and self._running:
            self.pipe.stop()
            self._running = False

    def get_frames(self):
        """The ONLY method that calls pipe.wait_for_frames() — must only
        ever be called from a single thread (the MJPEG generator loop in
        main.py). Calling this concurrently from a second thread (e.g. the
        align point tracker used to call it directly) races against the
        RealSense pipeline and was causing the tracker to see stale/
        skipped frames — exactly what caused the "points don't track in
        real time, runs away" divergence seen on hardware 2026-07-25.
        Anything else that needs a frame reads get_latest_color() or the
        _depth_buf (via sample_depth/sample_plane_region_grow) instead."""
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
        return df, cf

    def get_latest_accel(self):
        """Most recent accelerometer sample (ax,ay,az in m/s^2, D455 IMU
        axes — raw, no extrinsic correction to the optical frame), or None
        if the IMU isn't streaming. Thread-safe read, same pattern as
        get_latest_color()."""
        with self._accel_lock:
            return self._accel_buf

    def get_latest_color(self, max_wait: float = 2.0):
        """Most recent color frame, written by get_frames() — does NOT
        call pipe.wait_for_frames() itself, so it's safe to call from any
        thread (used by align.py's point tracker). Waits briefly for the
        MJPEG generator loop to have produced at least one frame; returns
        None if it times out (camera not running, or nobody has
        /video_feed open to drive frame capture — caller must abort, not
        guess)."""
        deadline = _time() + max_wait
        while _time() < deadline:
            with self._color_lock:
                if self._color_buf is not None:
                    return self._color_buf
            sleep(0.02)
        return None

    def _wait_depth_buf(self, min_frames: int = 3) -> list:
        """Block briefly for the MJPEG generator's rolling buffer to fill
        (that loop plays the role pick_45degree.py's view_loop played).
        Falls back to direct capture when nobody has /video_feed open."""
        for _ in range(15):
            with self._depth_lock:
                buf = list(self._depth_buf)
            if len(buf) >= min_frames:
                return buf
            sleep(0.03)
        for _ in range(5):
            self.get_frames()
            with self._depth_lock:
                buf = list(self._depth_buf)
            if len(buf) >= min_frames:
                return buf
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
        full = np.median(np.stack(buf), axis=0).astype(float)
        fx = self.intrinsics["fx"]; fy = self.intrinsics["fy"]
        cx = self.intrinsics["cx"]; cy = self.intrinsics["cy"]

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
