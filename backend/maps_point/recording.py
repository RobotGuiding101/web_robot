"""maps_point/recording.py — per-run recording for align: a JPEG snapshot
(with the same overlay the live page shows) plus a structured log line for
every meaningful step, saved to disk under recordings/align_<timestamp>/.

Exists because a run can behave in a way that's hard to diagnose from the
live page alone (2026-07-25e: align kept moving the same direction for many
steps even as the reported tilt got worse, ending in "lost tracking" — by
the time that's visible on screen, the evidence of WHY is already gone).
With this, every step's image + numbers are on disk afterward for review.
"""
import json
import time
from pathlib import Path
from datetime import datetime

import cv2

from .render import draw_overlay
from .logs import log as _global_log

RECORDINGS_DIR = Path(__file__).parent / "recordings"


class AlignRecorder:
    def __init__(self):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.dir = RECORDINGS_DIR / f"align_{ts}"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.step = 0
        self.log_path   = self.dir / "log.txt"
        self.jsonl_path = self.dir / "steps.jsonl"
        self.log(f"  [Align] recording to {self.dir}")

    def log(self, msg: str):
        """Same message as the app-wide log() (terminal + Server Log
        panel), ALSO appended to this run's own log.txt."""
        _global_log(msg)
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(msg + "\n")

    def snap(self, robot, cam, state, label: str, extra: dict = None):
        """Save a JPEG (current camera frame + the live overlay — points,
        polygon, tilt/rmse/status text) and a JSON line with whatever
        numbers mattered at this step. label is a short tag, e.g.
        'phase0', 'probe_rx_before', 'step003_ry'.

        Also records the robot's actual pose (X,Y,Z,Rx,Ry,Rz) and, if the
        D455's IMU is available, the raw accelerometer reading — added
        2026-07-27g because a diagnostic session tried to answer "which
        way is it really tilting" from marked-point pixel drift alone and
        couldn't do so with full confidence. pose is ground truth from the
        controller; accel is an independent, physically-grounded check
        (gravity direction in the camera's own IMU axes) that depends on
        neither the vision PCA fit nor the robot's own reported pose —
        three independent views of the same motion to cross-check against
        each other next time this comes up."""
        self.step += 1
        frame = cam.get_latest_color()
        if frame is not None:
            img = draw_overlay(frame.copy(), state)
            cv2.imwrite(str(self.dir / f"{self.step:03d}_{label}.jpg"), img)
        record = {
            "step": self.step,
            "label": label,
            "t": time.time(),
            "points": list(state.points),
            "tilt": state.last_tilt,
            "rmse": state.last_rmse,
            "depth_range": state.last_depth_range,
            "status": state.status,
            "pose": robot.get_pose(),
        }
        accel = cam.get_latest_accel()
        if accel is not None:
            record["accel"] = list(accel)
        if extra:
            record.update(extra)
        with open(self.jsonl_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
