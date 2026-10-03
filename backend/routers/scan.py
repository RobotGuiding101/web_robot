"""routers/scan.py — multi-view point-cloud scan + fusion.

cam2 (static) is scanned where it stands; cam1 (arm-mounted) can be captured at
several jogged poses; every view is stored in the robot base frame so the clouds
can be concatenated into one fused surface. Raw fused clouds are saved per
session under scan_sessions/ (bind-mounted, survives restart).

Extrinsics: cam2 needs a one-time camera->base transform (camera_extrinsics.json).
cam1 is eye-in-hand — its view transform comes from get_pose() at capture time.
Until calibrated we fall back to a per-view manual offset (the viewer's
hand-tuned mount values), which is good enough for a first visual overlay.
"""
import json
import math
import struct
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from jose import JWTError, jwt
from pydantic import BaseModel

from routers.auth import ALGORITHM, SECRET_KEY, get_current_user
from routers.device_events import log_event

router = APIRouter(prefix="/api/scan", tags=["Scan"])

# REST-only auth: route decorators below add this to HTTP endpoints. Router-
# level dependencies in main.py would also hit the websocket routes, which
# authenticate via their own query token instead.
_AUTH = [Depends(get_current_user)]

BASE_DIR = Path(__file__).resolve().parents[1]
SESSIONS_DIR = BASE_DIR / "scan_sessions"
EXTRINSICS_PATH = BASE_DIR / "camera_extrinsics.json"
MAX_VIEWS = 60
VIEW_POINT_CAP = 60000
LIVE_POINT_CAP = 6000
LIVE_VOXEL_M = 0.02
LIVE_INTERVAL_S = 0.15
# D455 depth is unreliable under ~30cm (±2cm), so scan drops every return
# closer than this. Kept separate from maps_point.config.MIN_DEPTH_MM (330mm)
# so the align / region-grow path is unaffected.
SCAN_MIN_DEPTH_MM = 300.0
SAVE_FORMAT_VERSION = 1

_lock = threading.Lock()
_views: list[dict] = []
_fused: Optional[dict] = None
_extrinsics: Optional[dict] = None


# ── transforms ────────────────────────────────────────────────────────────────
def _euler_zyx_to_R(rx_deg, ry_deg, rz_deg):
    rx, ry, rz = np.deg2rad([rx_deg, ry_deg, rz_deg])
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    return Rz @ Ry @ Rx


def _euler_xyz_to_R(rx_deg, ry_deg, rz_deg):
    """XYZ extrinsic order — Three.js Object3D.rotation default. The viewer
    tunes mounts with rotation.set(x,y,z), so mount transforms must build the
    matrix the same way or a saved value won't reproduce what was seen."""
    rx, ry, rz = np.deg2rad([rx_deg, ry_deg, rz_deg])
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz


def _pose_to_T(pose_mm_deg):
    """[X,Y,Z,Rx,Ry,Rz] (mm, deg) -> 4x4 in metres."""
    x, y, z, rx, ry, rz = [float(v) for v in pose_mm_deg]
    T = np.eye(4)
    T[:3, :3] = _euler_zyx_to_R(rx, ry, rz)
    T[:3, 3] = [x / 1000.0, y / 1000.0, z / 1000.0]
    return T


def _xyzrpy_to_T(entry):
    """{'xyz': [m,m,m], 'rpy': [rx,ry,rz] deg} -> 4x4. Mount entries come from
    the viewer's tune sliders (Three.js XYZ euler), so rotation uses that order."""
    T = np.eye(4)
    T[:3, :3] = _euler_xyz_to_R(*entry.get("rpy", [0, 0, 0]))
    T[:3, 3] = entry.get("xyz", [0, 0, 0])
    return T


def _mount_for(cam_index: int) -> np.ndarray:
    """camera-in-flange (cam1) / camera-in-base (cam2) mount, from the saved
    extrinsics file, else the viewer's hand-tuned defaults."""
    ex = _extrinsics or {}
    if cam_index == 2:
        entry = ex.get("cam2_to_base")
        if entry:
            return _xyzrpy_to_T(entry)
        return _xyzrpy_to_T({"xyz": [0.026, 0.737, 0.798], "rpy": [-74.3, 0, 0]})
    entry = ex.get("cam1_to_flange")
    if entry:
        return _xyzrpy_to_T(entry)
    return _xyzrpy_to_T({"xyz": [0.06, 0.048, -0.017], "rpy": [-178, 0, 180]})


def _view_transform(cam_index: int, pose_mm_deg) -> np.ndarray:
    if cam_index == 2:
        return _mount_for(2)
    return _pose_to_T(pose_mm_deg) @ _mount_for(1)


def load_extrinsics():
    global _extrinsics
    try:
        _extrinsics = json.loads(EXTRINSICS_PATH.read_text(encoding="utf-8"))
    except Exception:
        _extrinsics = None


def save_extrinsics() -> None:
    try:
        EXTRINSICS_PATH.write_text(json.dumps(_extrinsics or {}, indent=2),
                                   encoding="utf-8")
    except Exception:
        pass


load_extrinsics()


# ── cloud sources ─────────────────────────────────────────────────────────────
def _camera_for(index: int):
    if index == 2:
        from routers.camera import get_cam2
        return get_cam2()
    from routers.mapcontrol import cam
    return cam


def _pose_for(index: int):
    if index == 2:
        return [0.0] * 6
    from routers.mapcontrol import robot
    try:
        robot.ensure_frame()
        return robot.get_pose()
    except Exception:
        return [0.0] * 6


def _grab_cloud(index: int, cap: int):
    c = _camera_for(index)
    if c is None or not getattr(c, "_running", False):
        return None, None
    pos, col = c.get_latest_pointcloud()
    if pos is None or pos.shape[0] == 0:
        return None, None
    # D455 depth is unreliable below ~35cm (±2cm error), and the arm-mounted
    # cam1 often sits closer than that — drop those returns (z = distance from
    # the camera in its own frame) before they poison the fusion.
    z = pos[:, 2]
    valid = np.isfinite(z) & (z * 1000.0 >= SCAN_MIN_DEPTH_MM)
    if not valid.any():
        return None, None
    pos = pos[valid]
    col = col[valid]
    if cap and pos.shape[0] > cap:
        idx = np.linspace(0, pos.shape[0] - 1, cap).astype(np.int64)
        pos, col = pos[idx], col[idx]
    return pos.astype(np.float32), np.ascontiguousarray(col, dtype=np.uint8)


def _transform_cloud(T, pos):
    return (T[:3, :3] @ pos.T).T + T[:3, 3]


def _transformed(index: int, cap: int):
    pos, col = _grab_cloud(index, cap)
    if pos is None:
        return None, None, None
    T = _view_transform(index, _pose_for(index))
    return _transform_cloud(T, pos), col, T


# ── views / fusion ────────────────────────────────────────────────────────────
def _voxel_downsample(points, voxel):
    if points.shape[0] == 0 or voxel <= 0:
        return points, np.arange(points.shape[0])
    keys = np.floor(points / voxel).astype(np.int64)
    _, uniq = np.unique(keys, axis=0, return_index=True)
    uniq.sort()
    return points[uniq], uniq


def _fuse_points(view_list, voxel=0.004, outlier_k=8):
    xs, cs = [], []
    for v in view_list:
        xs.append(v["xyz"])
        cs.append(v["rgb"])
    if not xs:
        return None, None
    by_cam = {}
    for v in view_list:
        by_cam.setdefault(v["cam"], []).append(v)
    if len(by_cam) >= 2:
        clouds, colors = [], []
        for cam in sorted(by_cam):
            pts = np.concatenate([v["xyz"] for v in by_cam[cam]], axis=0)
            col = np.concatenate([v["rgb"] for v in by_cam[cam]], axis=0)
            clouds.append(pts)
            colors.append(col)
        P, C = _voxel_consensus(clouds, colors, voxel=voxel * 4)
        if P is not None and P.shape[0]:
            P, keep = _voxel_downsample(P, voxel)
            C = C[keep]
            return P.astype(np.float32), C.astype(np.uint8)
        # No voxel agreed — extrinsics are likely uncalibrated, so the two
        # clouds don't overlap at all. Fall back to a plain union so the
        # operator still sees something to tune against.
        P = np.concatenate(clouds, axis=0)
        C = np.concatenate(colors, axis=0)
        P, keep = _voxel_downsample(P, voxel)
        C = C[keep]
        return P.astype(np.float32), C.astype(np.uint8)
    P = np.concatenate(xs, axis=0)
    C = np.concatenate(cs, axis=0)
    P, keep = _voxel_downsample(P, voxel)
    C = C[keep]
    if P.shape[0] > outlier_k + 2:
        P, C = _statistical_outlier_removal(P, C, outlier_k)
    return P.astype(np.float32), C.astype(np.uint8)


def _statistical_outlier_removal(P, C, k=8, std_ratio=1.5):
    try:
        from scipy.spatial import cKDTree
        tree = cKDTree(P)
        dists, _ = tree.query(P, k=min(k, P.shape[0]))
        mean_d = dists[:, 1:].mean(axis=1)
        thresh = mean_d.mean() + std_ratio * mean_d.std()
        keep = mean_d <= thresh
        return P[keep], C[keep]
    except Exception:
        return P, C


def _voxel_consensus(clouds, colors, voxel=0.015):
    """Keep only voxels seen by EVERY camera (voxel intersection).

    A point visible to one camera but not the other is either occluded (the
    arm/cam1 standing in front of cam2) or noise; requiring agreement on the
    same voxel drops those ghosts. Colour is taken from the camera whose point
    sits nearest that voxel's centre (closer = more confident). Voxels are keyed
    by a lossless packed int64 (no hash collisions) and matched with
    intersect1d — dict/set-of-tuples took minutes on 8 real views."""
    if len(clouds) < 2:
        return None, None
    seen = []
    for P, C in zip(clouds, colors):
        if P.shape[0] == 0:
            return None, None
        keys = np.floor(P / voxel).astype(np.int64)
        k0 = keys[:, 0] + 100000
        k1 = keys[:, 1] + 100000
        k2 = keys[:, 2] + 100000
        # Pack x,y,z into one int64: offset each axis (cloud may be negative)
        # then interleave bits so no two voxels collide.
        packed = (k0 << 42) | (k1 << 21) | k2
        uniq, first = np.unique(packed, return_index=True)
        uniq.sort()
        pts = P[first]
        cols = C[first]
        centre = np.floor(pts / voxel) * voxel + voxel / 2
        d = np.linalg.norm(pts - centre, axis=1)
        seen.append((uniq, pts, cols, d))
    common = seen[0][0]
    for uniq, _, _, _ in seen[1:]:
        common = np.intersect1d(common, uniq)
        if common.shape[0] == 0:
            return None, None
    P0 = None
    C0 = None
    d0 = None
    for uniq, pts, cols, dist in seen:
        pos = np.searchsorted(uniq, common)
        pos = pos[(pos < len(uniq)) & (uniq[pos] == common)]
        Pi, Ci, di = pts[pos], cols[pos], dist[pos]
        if P0 is None:
            P0, C0, d0 = Pi, Ci.copy(), di
        else:
            taken = di < d0
            C0[taken] = Ci[taken]
            d0[taken] = di[taken]
    return P0.astype(np.float32), C0.astype(np.uint8)


# ── persistent accumulated map ────────────────────────────────────────────────
# Intersection drops every voxel one camera cannot see right now, so a moving
# arm that occludes cam2 makes already-mapped areas vanish from the live view.
# Instead we accumulate into a persistent voxel map that only grows: an area
# seen once stays, the occluder itself is mostly filtered by the 30cm depth
# gate, and sweeping the arm just adds more coverage.
_MAP_LOCK = threading.Lock()
_scan_map: dict = {}
MAP_VOXEL_M = 0.01
MAP_MAX_VOXELS = 300000


def _voxel_key(P, voxel=MAP_VOXEL_M):
    keys = np.floor(P / voxel).astype(np.int64)
    k0 = keys[:, 0] + 100000
    k1 = keys[:, 1] + 100000
    k2 = keys[:, 2] + 100000
    return (k0 << 42) | (k1 << 21) | k2


def _map_upsert(P, C):
    if P.shape[0] == 0:
        return
    keys = _voxel_key(P)
    uniq, first = np.unique(keys, return_index=True)
    Pv, Cv = P[first], C[first]
    with _MAP_LOCK:
        fresh = {int(k): (Pv[i].copy(), Cv[i].copy())
                 for i, k in enumerate(uniq) if int(k) not in _scan_map}
        _scan_map.update(fresh)
        over = len(_scan_map) - MAP_MAX_VOXELS
        if over > 0:
            for k in list(_scan_map.keys())[:over]:
                del _scan_map[k]


def _map_cloud(max_pts=0):
    """Materialise the accumulated map. max_pts>0 subsamples the voxel list
    before building arrays (live sends a small cloud every tick; building the
    full map each tick would eat a core on the Pi). max_pts=0 returns the full
    map for fuse/save."""
    with _MAP_LOCK:
        if not _scan_map:
            return None, None
        ks = list(_scan_map.keys())
        if max_pts and len(ks) > max_pts:
            idx = np.linspace(0, len(ks) - 1, max_pts).astype(np.int64)
            ks = [ks[i] for i in idx]
        P = np.empty((len(ks), 3), dtype=np.float32)
        C = np.empty((len(ks), 3), dtype=np.uint8)
        for i, k in enumerate(ks):
            P[i] = _scan_map[k][0]
            C[i] = _scan_map[k][1]
    return P, C


def _encode_cloud(P, C):
    if P is None or P.shape[0] == 0:
        return b""
    mm = np.clip(P * 1000.0, -32767.0, 32767.0).astype("<i2")
    rgb = np.ascontiguousarray(C, dtype=np.uint8)
    return struct.pack("<I", mm.shape[0]) + mm.tobytes() + rgb.tobytes()


# ── live fused websocket ──────────────────────────────────────────────────────
_scan_clients: set = set()
_live_latest: Optional[bytes] = None


def _live_loop():
    global _live_latest
    while True:
        has_clients = bool(_scan_clients)
        # Accumulate continuously (cam1 sweeping fills the areas cam2 cannot
        # see) even when nobody is watching; only the WS broadcast needs
        # clients. Idle cadence is slower to keep background CPU low.
        interval = LIVE_INTERVAL_S if has_clients else 0.3
        try:
            for idx in (1, 2):
                p, c, _ = _transformed(idx, LIVE_POINT_CAP)
                if p is not None and p.shape[0]:
                    _map_upsert(p, c)
            if has_clients:
                P, C = _map_cloud(LIVE_POINT_CAP)
                if P is not None and P.shape[0]:
                    _live_latest = _encode_cloud(P, C)
                    for ws in list(_scan_clients):
                        try:
                            ws.send_bytes(_live_latest)
                        except Exception:
                            _scan_clients.discard(ws)
        except Exception:
            pass
        time.sleep(interval)


threading.Thread(target=_live_loop, daemon=True).start()


@router.websocket("/ws")
async def ws_scan(websocket: WebSocket, token: str = ""):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    _scan_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _scan_clients.discard(websocket)


# ── server-side auto-align (ICP over WS) ─────────────────────────────────────
# The viewer used to fetch both clouds and run ICP client-side over HTTP every
# 700 ms (3 round trips per cycle). Now the backend runs ICP continuously and
# pushes the resulting cam2->base through /ws/align — the viewer just applies
# what arrives. Runs only while at least one client is connected.
_align_clients: set = set()
_align_latest: Optional[dict] = None
ALIGN_LOOP_S = 0.25                # ~4 Hz cadence
ALIGN_POINT_CAP = 2000             # per-cloud budget (ICP downsamples to 900)
# Only accept a small incremental correction vs the current mount, so one bad
# ICP can't teleport the extrinsic somewhere wild; hand-tune first, auto refines.
ALIGN_MAX_CORRECTION_M = 0.05
ALIGN_MAX_CORRECTION_RAD = 3.0 * math.pi / 180.0
# cam2 is bolted down — its base transform is a fixed physical quantity, so it
# must NOT be chased while the arm moves: each ICP run sees a different view
# and returns a slightly different answer, which warps the viewer. Align only
# while the arm is idle, and damp each accepted result toward the previous one.
ALIGN_ARM_STILL_S = 1.5
_align_T: Optional[np.ndarray] = None
_align_last_pose = None


def _blend_delta(D, w):
    """Damped 4x4 delta — axis-angle rotation and translation scaled by w,
    recomposed — so a stream of ICP results converges smoothly instead of
    stepping the extrinsic by each full correction."""
    R = D[:3, :3]
    ang = np.arccos(np.clip((float(np.trace(R)) - 1.0) / 2.0, -1.0, 1.0))
    if ang < 1e-9:
        axis = np.array([1.0, 0.0, 0.0])
    else:
        axis = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0],
                         R[1, 0] - R[0, 1]]) / (2.0 * np.sin(ang))
    wa = ang * w
    K = np.array([[0.0, -axis[2], axis[1]],
                  [axis[2], 0.0, -axis[0]],
                  [-axis[1], axis[0], 0.0]])
    R_w = np.eye(3) + np.sin(wa) * K + (1.0 - np.cos(wa)) * (K @ K)
    D_w = np.eye(4)
    D_w[:3, :3] = R_w
    D_w[:3, 3] = D[:3, 3] * w
    return D_w


def _blend_weight(t_len, ang):
    """Adaptive step size: large remaining error converges fast, fine steps
    near the end — a few pushes instead of a long tail."""
    e = max(t_len, ang * 0.05)
    if e > 0.03:
        return 0.6
    if e > 0.008:
        return 0.35
    return 0.15


def _T_to_xyzrpy(T):
    """4x4 -> [rx, ry, rz] (deg) using the SAME XYZ euler order as
    _euler_xyz_to_R (Three.js Object3D.rotation default). Without this the
    saved extrinsic wouldn't reproduce what the viewer displayed."""
    R = T[:3, :3]
    sy = float(math.hypot(R[0, 0], R[0, 1]))
    if sy > 1e-9:
        rx = math.atan2(-R[1, 2], R[2, 2])
        ry = math.atan2(R[0, 2], sy)
        rz = math.atan2(-R[0, 1], R[0, 0])
    else:
        rx = math.atan2(-R[1, 2], R[1, 1])
        ry = math.atan2(R[0, 2], sy)
        rz = 0.0
    return [round(math.degrees(rx), 3), round(math.degrees(ry), 3),
            round(math.degrees(rz), 3)]


def _align_loop():
    global _align_latest, _align_T, _align_last_pose
    while True:
        if not _align_clients:
            _align_latest = None
            _align_T = None
            _align_last_pose = None
            time.sleep(ALIGN_LOOP_S)
            continue
        try:
            # Skip while the arm is moving or just moved: cam1's view changes,
            # so each ICP run returns a different cam2->base and the viewer
            # would warp. Align only when both cameras hold a stable scene.
            from routers.mapcontrol import state
            pose = _pose_for(1)
            arm_moved = (time.time() - getattr(state, "robot_motion_ts", 0.0)
                         < ALIGN_ARM_STILL_S)
            if _align_last_pose is not None:
                arm_moved = arm_moved or (np.max(np.abs(
                    np.asarray(pose, dtype=np.float64)
                    - np.asarray(_align_last_pose, dtype=np.float64))) > 0.1)
            _align_last_pose = pose
            if arm_moved:
                time.sleep(ALIGN_LOOP_S)
                continue
            # ICP source = cam2 raw (its own optical frame); target = cam1's
            # view of the same scene expressed in the base frame. The T that
            # maps cam2-raw onto base IS cam2->base by construction.
            pos2, _ = _grab_cloud(2, ALIGN_POINT_CAP)
            pos1, _ = _grab_cloud(1, ALIGN_POINT_CAP)
            if (pos1 is None or pos2 is None
                    or pos1.shape[0] < 100 or pos2.shape[0] < 100):
                time.sleep(ALIGN_LOOP_S)
                continue
            xyz1 = _transform_cloud(_view_transform(1, pose), pos1)
            from routers.mapcontrol import _icp_align
            res = _icp_align(np.asarray(pos2, dtype=np.float64),
                             np.asarray(xyz1, dtype=np.float64),
                             iters=20, max_dist=0.05, keep_frac=0.6)
            if res is None:
                time.sleep(ALIGN_LOOP_S)
                continue
            T, fitness, rmse = res
            if fitness < 0.5 or rmse > 0.02:
                time.sleep(ALIGN_LOOP_S)
                continue
            d = T @ np.linalg.inv(_mount_for(2))
            t_len = float(np.linalg.norm(d[:3, 3]))
            ang = 2.0 * math.acos(min(1.0, max(-1.0,
                                                float(np.trace(d[:3, :3]) - 1.0) / 2.0)))
            if t_len > ALIGN_MAX_CORRECTION_M or ang > ALIGN_MAX_CORRECTION_RAD:
                time.sleep(ALIGN_LOOP_S)
                continue
            if _align_T is None:
                # Start from the current stored mount so even the first push
                # is blended — applying the first ICP result in full would
                # visibly jump cam2 away (two separated layers) before it
                # converges back.
                _align_T = _mount_for(2).copy()
            d = T @ np.linalg.inv(_align_T)
            t_len = float(np.linalg.norm(d[:3, 3]))
            ang = 2.0 * math.acos(min(1.0, max(-1.0,
                                                float(np.trace(d[:3, :3]) - 1.0) / 2.0)))
            _align_T = _align_T @ _blend_delta(d, _blend_weight(t_len, ang))
            xyz = _align_T[:3, 3]
            rpy = _T_to_xyzrpy(_align_T)
            with _lock:
                _extrinsics = _extrinsics or {}
                _extrinsics["cam2_to_base"] = {"xyz": [float(v) for v in xyz],
                                               "rpy": rpy}
                save_extrinsics()
            _align_latest = {"xyz": [float(v) for v in xyz], "rpy": rpy,
                             "fitness": float(fitness), "rmse": float(rmse)}
            for ws in list(_align_clients):
                try:
                    ws.send_text(json.dumps(_align_latest))
                except Exception:
                    _align_clients.discard(ws)
        except Exception:
            pass
        time.sleep(ALIGN_LOOP_S)


threading.Thread(target=_align_loop, daemon=True).start()


@router.websocket("/ws/align")
async def ws_align(websocket: WebSocket, token: str = ""):
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    _align_clients.add(websocket)
    if _align_latest:
        try:
            await websocket.send_text(json.dumps(_align_latest))
        except Exception:
            pass
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _align_clients.discard(websocket)


# ── REST ──────────────────────────────────────────────────────────────────────
class CaptureBody(BaseModel):
    cam: int = 2
    label: str = ""


class ExtrinsicBody(BaseModel):
    cam1_to_flange: Optional[dict] = None
    cam2_to_base: Optional[dict] = None


class SaveBody(BaseModel):
    name: str = ""


@router.post("/capture", dependencies=_AUTH)
def capture(request: Request, body: CaptureBody):
    idx = 2 if body.cam == 2 else 1
    pos, col = _grab_cloud(idx, VIEW_POINT_CAP)
    if pos is None:
        return {"ok": False, "error": f"camera {idx} cloud not ready"}
    pose = _pose_for(idx)
    T = _view_transform(idx, pose)
    xyz = _transform_cloud(T, pos)
    _map_upsert(xyz, col)
    with _lock:
        if len(_views) >= MAX_VIEWS:
            return {"ok": False, "error": f"view limit ({MAX_VIEWS}) reached"}
        vid = len(_views) + 1
        _views.append({
            "id": vid, "cam": idx, "label": body.label or f"cam{idx}-{vid}",
            "ts": time.time(), "pose": pose, "n": int(xyz.shape[0]),
            "xyz": xyz.astype(np.float32), "rgb": col,
        })
    return {"ok": True, "id": vid, "n": int(xyz.shape[0]), "views": len(_views)}


@router.get("/views", dependencies=_AUTH)
def list_views():
    with _lock:
        out = {"views": [{"id": v["id"], "cam": v["cam"], "label": v["label"],
                          "n": v["n"], "ts": v["ts"]} for v in _views],
               "fused": bool(_fused)}
    with _MAP_LOCK:
        out["map_n"] = len(_scan_map)
    return out


@router.delete("/views/{vid}", dependencies=_AUTH)
def delete_view(vid: int):
    with _lock:
        global _views
        _views = [v for v in _views if v["id"] != vid]
    return {"ok": True, "views": len(_views)}


@router.post("/views/clear", dependencies=_AUTH)
def clear_views():
    with _lock:
        _views.clear()
    with _MAP_LOCK:
        _scan_map.clear()
    try:
        from routers.camera import reset_cam2_depth_map
        reset_cam2_depth_map()
    except Exception:
        pass
    return {"ok": True}


@router.post("/fuse", dependencies=_AUTH)
def fuse():
    global _fused
    with _lock:
        snapshot = list(_views)
    with _MAP_LOCK:
        has_map = bool(_scan_map)
    try:
        if has_map:
            P, C = _map_cloud(0)
            P, keep = _voxel_downsample(P, 0.004)
            C = C[keep]
            if P.shape[0] > 10:
                P, C = _statistical_outlier_removal(P, C, 8)
        else:
            P, C = _fuse_points(snapshot)
    except Exception as e:
        # Never kill the worker on a bad fusion — log the real traceback and
        # return a plain error; a silent 500 (or a dead worker) is worse.
        import traceback
        print("[scan] fuse failed:", e, flush=True)
        traceback.print_exc()
        return {"ok": False, "error": f"fusion failed: {e}"}
    if P is None:
        return {"ok": False, "error": "no views captured"}
    with _lock:
        _fused = {"xyz": P, "rgb": C, "n": int(P.shape[0])}
    return {"ok": True, "n": int(P.shape[0]), "views": len(snapshot)}


@router.get("/cloud", dependencies=_AUTH)
def fused_cloud(max_pts: int = 0):
    with _lock:
        f = _fused
    if not f:
        return Response(status_code=503)
    P, C = f["xyz"], f["rgb"]
    if max_pts and P.shape[0] > max_pts:
        idx = np.linspace(0, P.shape[0] - 1, max_pts).astype(np.int64)
        P, C = P[idx], C[idx]
    body = _encode_cloud(P, C)
    if not body:
        return Response(status_code=503)
    return Response(content=body, media_type="application/octet-stream")


def _session_dir(ts=None):
    name = time.strftime("%Y%m%d_%H%M%S", time.localtime(ts))
    d = SESSIONS_DIR / name
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/save", dependencies=_AUTH)
def save_session(request: Request, body: SaveBody):
    global _fused
    with _lock:
        snapshot = list(_views)
        f = _fused
    if not snapshot:
        return {"ok": False, "error": "no views captured"}
    if f is None:
        P, C = _fuse_points(snapshot)
        if P is None:
            return {"ok": False, "error": "fusion failed"}
        with _lock:
            _fused = {"xyz": P, "rgb": C, "n": int(P.shape[0])}
            f = _fused
    d = _session_dir()
    np.savez_compressed(d / "views.npz",
                        **{f"v{v['id']}_xyz": v["xyz"] for v in snapshot},
                        **{f"v{v['id']}_rgb": v["rgb"] for v in snapshot})
    np.savez_compressed(d / "fused.npz", xyz=f["xyz"], rgb=f["rgb"])
    _write_ply(d / "fused.ply", f["xyz"], f["rgb"])
    meta = {
        "version": SAVE_FORMAT_VERSION,
        "name": body.name or d.name,
        "created": time.time(),
        "n_points": f["n"],
        "voxel_m": 0.004,
        "extrinsics": _extrinsics or {},
        "views": [{"id": v["id"], "cam": v["cam"], "label": v["label"],
                   "n": v["n"], "pose": v["pose"]} for v in snapshot],
    }
    (d / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    try:
        log_event(getattr(request.state, "user_id", ""), "scan", "save",
                  f"{d.name} n={f['n']} views={len(snapshot)}")
    except Exception:
        pass
    return {"ok": True, "session": d.name, "n": f["n"], "views": len(snapshot)}


def _write_ply(path, P, C):
    n = P.shape[0]
    header = (f"ply\nformat binary_little_endian 1.0\nelement vertex {n}\n"
              "property float x\nproperty float y\nproperty float z\n"
              "property uchar red\nproperty uchar green\nproperty uchar blue\n"
              "end_header\n")
    rec = np.empty(n, dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"),
                             ("red", "u1"), ("green", "u1"), ("blue", "u1")])
    rec["x"], rec["y"], rec["z"] = P[:, 0], P[:, 1], P[:, 2]
    rec["red"], rec["green"], rec["blue"] = C[:, 0], C[:, 1], C[:, 2]
    with open(path, "wb") as fh:
        fh.write(header.encode("ascii"))
        fh.write(rec.tobytes())


@router.get("/sessions", dependencies=_AUTH)
def list_sessions():
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for d in sorted(SESSIONS_DIR.iterdir(), reverse=True):
        meta = d / "meta.json"
        if d.is_dir() and meta.exists():
            try:
                m = json.loads(meta.read_text(encoding="utf-8"))
                out.append({"session": d.name, "n": m.get("n_points"),
                            "views": len(m.get("views", [])), "name": m.get("name")})
            except Exception:
                pass
    return {"sessions": out}


@router.post("/load/{session}", dependencies=_AUTH)
def load_session(session: str):
    global _fused
    d = SESSIONS_DIR / session
    fp = d / "fused.npz"
    if not fp.exists():
        return {"ok": False, "error": "session not found"}
    data = np.load(fp)
    with _lock:
        _fused = {"xyz": data["xyz"], "rgb": data["rgb"], "n": int(data["xyz"].shape[0])}
    return {"ok": True, "n": _fused["n"]}


@router.get("/extrinsics", dependencies=_AUTH)
def get_extrinsics():
    return {"extrinsics": _extrinsics or {}}


@router.post("/extrinsics", dependencies=_AUTH)
def set_extrinsics(body: ExtrinsicBody):
    global _extrinsics, _align_T, _align_last_pose
    _extrinsics = _extrinsics or {}
    if body.cam1_to_flange is not None:
        _extrinsics["cam1_to_flange"] = body.cam1_to_flange
    if body.cam2_to_base is not None:
        _extrinsics["cam2_to_base"] = body.cam2_to_base
    # A manual tune restarts the auto-align blend from the new value.
    _align_T = None
    _align_last_pose = None
    save_extrinsics()
    return {"ok": True, "extrinsics": _extrinsics}
