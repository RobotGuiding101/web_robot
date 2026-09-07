"""maps_point/render.py — frame annotation shared by the live MJPEG stream
(main.py) and align run recordings (recording.py). Pure image drawing —
no Flask, no hardware calls — so both can draw the exact same overlay.
"""
import cv2
import numpy as np


def draw_overlay(frame, state):
    h, w = frame.shape[:2]
    # optical centre — same convention as pick_45degree.py's view_loop
    cx_i, cy_i = w // 2, h // 2
    cv2.drawMarker(frame, (cx_i, cy_i), (100, 100, 100), cv2.MARKER_CROSS, 20, 1, cv2.LINE_AA)

    for i, (px, py) in enumerate(state.points):
        cv2.drawMarker(frame, (px, py), (0, 230, 255), cv2.MARKER_CROSS, 20, 2, cv2.LINE_AA)
        cv2.putText(frame, str(i + 1), (px + 8, py - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 230, 255), 1, cv2.LINE_AA)
    if len(state.points) >= 2:
        poly = np.array(state.points, dtype=np.int32)
        cv2.polylines(frame, [poly], len(state.points) == 4, (0, 200, 255), 2, cv2.LINE_AA)

    txt = state.status
    if state.last_tilt is not None:
        txt += f"  tilt={state.last_tilt:.1f}°"
    if state.last_rmse is not None:
        txt += f"  rmse={state.last_rmse:.2f}mm"
    if state.last_depth_range is not None:
        txt += f"  range={state.last_depth_range:.1f}mm"
    if state.last_roll_deg is not None:
        txt += f"  roll={state.last_roll_deg:.1f}°"
    if state.last_center_depth is not None:
        txt += f"  depth={state.last_center_depth:.0f}mm"
    cv2.rectangle(frame, (0, h - 24), (w, h), (28, 28, 28), -1)
    cv2.putText(frame, txt, (6, h - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 220, 200), 1, cv2.LINE_AA)

    if state.heatmap_mode:
        cv2.putText(frame, "DEPTH HEATMAP", (w - 150, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (80, 80, 255), 1, cv2.LINE_AA)
    return frame
