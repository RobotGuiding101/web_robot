"""state_store.py — persist the in-memory marks + taught grid so a backend
restart does not wipe a hand-taught setup. Same file-based approach as
maps_point/floorcalib.py (no DB dependency).
"""
import json
import threading
from pathlib import Path
from time import sleep

SNAP_PATH = Path(__file__).resolve().parent / "state_snapshot.json"


def save(state) -> None:
    try:
        SNAP_PATH.write_text(json.dumps({
            "points": [[float(p[0]), float(p[1])] for p in state.points],
            "grid_rows": int(state.grid_rows),
            "grid_cols": int(state.grid_cols),
            "grid_points": state.grid_points,
        }), encoding="utf-8")
    except Exception:
        pass


def load(state) -> None:
    try:
        if not SNAP_PATH.exists():
            return
        d = json.loads(SNAP_PATH.read_text(encoding="utf-8"))
        pts = [[float(p[0]), float(p[1])] for p in d.get("points", [])]
        state.points = [tuple(p) for p in pts]
        if pts:
            state.points_gen += 1
        rows = int(d.get("grid_rows", state.grid_rows))
        cols = int(d.get("grid_cols", state.grid_cols))
        gp = d.get("grid_points")
        valid = (2 <= rows and 2 <= cols and isinstance(gp, list) and len(gp) == rows
                 and all(isinstance(r, list) and len(r) == cols for r in gp))
        if valid:
            state.grid_rows, state.grid_cols = rows, cols
            state.grid_points = gp
    except Exception:
        pass


def start_autosave(state, period: float = 2.0) -> None:
    """Write a snapshot whenever the watched fields change (checked every
    `period` s). Cheap because marks/grid are tiny."""
    def _loop():
        last = None
        while True:
            try:
                snap = (tuple(map(tuple, state.points)), state.grid_rows, state.grid_cols,
                        json.dumps(state.grid_points, default=str))
                if snap != last:
                    save(state)
                    last = snap
            except Exception:
                pass
            sleep(period)

    threading.Thread(target=_loop, daemon=True).start()
