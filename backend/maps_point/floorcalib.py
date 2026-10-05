"""floorcalib.py — floor-plane homography for a fixed overhead camera.

Eye-to-hand: the D455 is mounted looking down at the floor, so a 3x3
homography H maps an image pixel on the floor plane to an ABSOLUTE
robot-frame (X, Y) — independent of where the arm currently is (unlike
motion.pixel_to_world_xy, which is eye-in-hand and offsets from the
current pose). H is estimated by DLT from >= MIN_POINTS taught
correspondences of (pixel, robot XY).
"""
import json
from pathlib import Path

import numpy as np

CALIB_PATH = Path(__file__).resolve().parent.parent / "floor_calib.json"
MIN_POINTS = 4


def compute_homography(pairs):
    """DLT: pairs is [( (u,v), (X,Y) ), ...]. Returns 3x3 H (pixel->XY),
    normalized so H[2,2]=1, or None if too few / degenerate points."""
    if len(pairs) < MIN_POINTS:
        return None
    rows = []
    for (u, v), (X, Y) in pairs:
        rows.append([u, v, 1, 0, 0, 0, -X * u, -X * v, -X])
        rows.append([0, 0, 0, u, v, 1, -Y * u, -Y * v, -Y])
    a = np.asarray(rows, dtype=float)
    singular = np.linalg.svd(a, compute_uv=False)
    if singular.size < 2 or singular[-2] / singular[0] < 1e-9:
        return None
    _, _, vt = np.linalg.svd(a)
    h = vt[-1].reshape(3, 3)
    if abs(h[2, 2]) < 1e-12:
        return None
    return h / h[2, 2]


def apply_homography(h, u, v):
    """Pixel (u,v) -> robot-frame (X, Y), or None if the point maps to
    infinity (w ~ 0)."""
    p = np.asarray(h, dtype=float) @ np.array([u, v, 1.0])
    if abs(p[2]) < 1e-12:
        return None
    return (float(p[0] / p[2]), float(p[1] / p[2]))


def reprojection_rmse(h, pairs):
    """RMS pixel->robot XY error (mm) over the taught pairs, or None."""
    errs = []
    for (u, v), (X, Y) in pairs:
        r = apply_homography(h, u, v)
        if r is None:
            continue
        errs.append((r[0] - X) ** 2 + (r[1] - Y) ** 2)
    if not errs:
        return None
    return float(np.sqrt(np.mean(errs)))


def invert(h):
    """H maps pixel->XY; invert to map a robot XY back to a pixel (used to
    draw the predicted floor grid over the image)."""
    return np.linalg.inv(np.asarray(h, dtype=float)).tolist()


def save(pairs, h, floor_z=None):
    CALIB_PATH.write_text(json.dumps({
        "pairs": [[[float(u), float(v)], [float(X), float(Y)]]
                  for (u, v), (X, Y) in pairs],
        "H": None if h is None else np.asarray(h).tolist(),
        "floor_z": None if floor_z is None else float(floor_z),
    }, indent=2), encoding="utf-8")


def load():
    """Returns (pairs, h, floor_z). pairs is [] and h is None when there is
    no calibration yet."""
    if not CALIB_PATH.exists():
        return [], None, None
    try:
        data = json.loads(CALIB_PATH.read_text(encoding="utf-8"))
        pairs = [((float(p[0][0]), float(p[0][1])), (float(p[1][0]), float(p[1][1])))
                 for p in data.get("pairs", [])]
        h = None if data.get("H") is None else np.asarray(data["H"], dtype=float)
        return pairs, h, data.get("floor_z")
    except Exception:
        return [], None, None
