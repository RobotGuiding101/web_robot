"""maps_point/config.py (web_robot-dev copy) — all configuration in one
place: env vars loaded from backend/.maps_point.env (fully self-contained,
does NOT read move/.env.local or move/.env.pick_45degree).
"""
import os
from pathlib import Path

HERE   = Path(__file__).parent                       # backend/maps_point/
PARENT = HERE.parent                                 # backend/
# .maps_point.env lives next to this package inside the backend project
ENV_PATH = PARENT / ".maps_point.env"

from dotenv import load_dotenv
load_dotenv(ENV_PATH, override=True)  # self-contained

# ── robot ─────────────────────────────────────────────────────────────────────
ROBOT_IP   = os.environ.get("ROBOT_IP", "192.168.10.110")
MOVE_SPEED = int(os.environ.get("Z_CALIB_SPEED", "10"))

# ── camera ────────────────────────────────────────────────────────────────────
CAM_SERIAL     = os.environ.get("DEPTH_CAM_SERIAL", "")
CAM_X_SIGN     = int(os.environ.get("CAM_X_SIGN", "1"))
CAM_Y_SIGN     = int(os.environ.get("CAM_Y_SIGN", "1"))
MIN_DEPTH_MM   = float(os.environ.get("MIN_DEPTH_MM", "330.0"))
DEPTH_N_FRAMES = int(os.environ.get("DEPTH_N_FRAMES", "30"))
DEPTH_ROI      = int(os.environ.get("DEPTH_ROI", "15"))

# physical offset: camera optical centre vs robot TCP, in robot frame (mm).
# Unmeasured (0.0) by default — the pre-align "move to center" step is only
# a rough approach position, not a precision pick, so this is fine left at
# 0 for now; fill in if you measure it later (see pick_45degree.py).
CAM_TCP_OFFSET_X = float(os.environ.get("CAM_TCP_OFFSET_X", "0.0"))
CAM_TCP_OFFSET_Y = float(os.environ.get("CAM_TCP_OFFSET_Y", "0.0"))

# Tool coordinate index — probe tip, taught in DobotStudio Pro (Settings →
# Tool Coordinate → Tool 1). Pivot for the align rotation. GetPose/MovL
# elsewhere stay on Tool 0 (flange) — see robot.Robot.init_robot().
WELD_TOOL_INDEX = int(os.environ.get("WELD_TOOL_INDEX", "1"))

# ── align ─────────────────────────────────────────────────────────────────────
# rotate in place (pivot = Tool 1 / probe tip) until the camera sees the
# marked plane dead-on. Same algorithm as pick_45degree.py's
# do_align_normal(): probe each axis's sign first, then converge — plus a
# "fine" phase: once tilt drops under ALIGN_FINE_TILT_DEG, steps are scaled
# down by ALIGN_FINE_SCALE so the last stretch approaches smoothly instead
# of overshooting/oscillating at full step size. ALIGN_MAX_STEPS is the
# direct total-step ceiling for phase 3's convergence loop (hard safety
# limit, not a target the loop tries to hit) — moved here 2026-07-28n at
# the user's request so it's a single number set directly in this file,
# instead of align.py computing it as ALIGN_MAX_ITERS * 2.
ALIGN_GAIN_DEG      = float(os.environ.get("ALIGN_GAIN_DEG",     "20.0"))
ALIGN_MAX_STEP_DEG  = float(os.environ.get("ALIGN_MAX_STEP_DEG", "5.0"))
ALIGN_TOL_DEG       = float(os.environ.get("ALIGN_TOL_DEG",      "1.5"))
ALIGN_MAX_STEPS     = int(os.environ.get("ALIGN_MAX_STEPS",      "100"))
ALIGN_PROBE_DEG     = float(os.environ.get("ALIGN_PROBE_DEG",    "3.0"))
ALIGN_FINE_TILT_DEG = float(os.environ.get("ALIGN_FINE_TILT_DEG", "5.0"))
ALIGN_FINE_SCALE    = float(os.environ.get("ALIGN_FINE_SCALE",    "0.4"))
# extra lift added ONLY to align's phase-0 "move to center" height (HOME_Z
# + this), not to the standalone Goto click mode — HOME_Z alone put the
# camera too close to see the surface properly (D455 min depth range).
ALIGN_APPROACH_Z_OFFSET = float(os.environ.get("ALIGN_APPROACH_Z_OFFSET", "50.0"))
# divergence safety net: the loop used to trust sign_rx/sign_ry blindly
# forever once learned — on hardware 2026-07-25e it kept moving the same
# direction for many steps even as the reported tilt got WORSE each time,
# ending in "lost tracking" instead of stopping early. Now it aborts after
# this many CONSECUTIVE steps where tilt increased by more than the margin
# (not just measurement noise) — something is wrong (bad tracking, or the
# learned sign doesn't hold at this pose) and it should stop, not guess.
ALIGN_DIVERGE_MARGIN_DEG = float(os.environ.get("ALIGN_DIVERGE_MARGIN_DEG", "0.5"))
ALIGN_DIVERGE_STREAK     = int(os.environ.get("ALIGN_DIVERGE_STREAK",       "2"))
# A sign learned once by _probe_align_sign() at the START of a run doesn't
# necessarily hold for the whole trajectory — on hardware 2026-07-27, ry's
# sign was learned correctly (large, clear probe signal) yet later in the
# SAME run started making tilt worse instead of better, while rx's sign had
# been learned from an almost-exact-zero probe reading (a coin flip) and
# also turned out wrong. Rather than only counting toward the hard abort,
# the FIRST time an axis's step makes tilt worse, do_align() re-probes that
# axis's sign on the spot and keeps going with whatever it learns — this
# caps how many times that can happen per run so a genuinely bad/noisy
# situation still falls through to the existing divergence abort instead of
# re-probing forever.
ALIGN_MAX_REPROBES = int(os.environ.get("ALIGN_MAX_REPROBES", "3"))
# Rotation-only convergence doesn't correct XY — nothing keeps the object
# centered in frame as tilt accumulates. On hardware 2026-07-27, ry did
# most of the real correcting and steadily pushed the marked box toward
# the bottom edge over 11 steps (tilt WAS improving, 21°→11.7°) until a
# point finally went out of frame and tracking failed. Whenever a tracked
# point comes within this fraction of any frame edge, do_align nudges XY
# (motion.goto_pixel, same Z/Rx/Ry/Rz) to bring it back toward center
# before continuing to rotate — instead of just running until it falls off.
ALIGN_RECENTER_MARGIN = float(os.environ.get("ALIGN_RECENTER_MARGIN", "0.12"))
# A long/narrow object's footprint can simply be wider than cam.w/h minus
# 2*ALIGN_RECENTER_MARGIN — no XY position at all satisfies the margin on
# both ends simultaneously, so the reactive re-center guard in do_align's
# phase 2 would otherwise fire, "fix", still see near_edge, and re-fire
# forever without ever reaching a rotation step (hardware 2026-08-05, a
# newly-taught long/narrow object vs. the previous square one). After this
# many CONSECUTIVE recenter attempts without near_edge clearing, do_align
# gives up trying to fully clear the margin for this step and proceeds to
# rotate anyway, rather than freezing.
ALIGN_MAX_RECENTER_ATTEMPTS = int(os.environ.get("ALIGN_MAX_RECENTER_ATTEMPTS", "3"))
# The 4 marked corners are tracked independently (optical flow, no shape
# constraint) — nothing stops ONE of them drifting off the object onto the
# background while the other 3 still look fine and tracking_ok stays True.
# On hardware 2026-07-27i this happened mid-run: rmse_mm jumped from
# ~0.65mm to 4.38mm (and depth_range_mm from 39mm to 296mm) in a single
# step once a corner slid onto the table behind the box — the PCA fit then
# quietly blended box-surface depth with table depth, tilt kept reporting
# plausible-looking numbers, and the run kept "converging" on a plane that
# wasn't the object's anymore. If rmse_mm exceeds this, the marked region
# is no longer flat/trustworthy — abort and ask the user to re-mark rather
# than continuing to chase a fictitious plane. Comfortably above the
# ~0.6-0.8mm seen on a clean, well-tracked box in every good run so far.
ALIGN_MAX_RMSE_MM = float(os.environ.get("ALIGN_MAX_RMSE_MM", "2.0"))
# Depth-only region growing (replaces optical-flow point tracking,
# 2026-07-28) — how close (mm) an adjacent pixel's actual depth must be to
# what the CURRENTLY-FITTED plane predicts there to count as "still part
# of the object". A background/table pixel won't satisfy this even if it
# happens to be visually similar to the object, which is the whole point:
# LK tracking could (and did, 2026-07-27i) lock onto the wrong feature
# with nothing to geometrically check it against. Comfortably above the
# ~0.6-0.8mm rmse seen on a clean fit, comfortably below the 30mm+ depth
# gap typically seen between a box and the table behind it.
ALIGN_DEPTH_TOL_MM = float(os.environ.get("ALIGN_DEPTH_TOL_MM", "5.0"))

# ── align: Rz (roll) correction, phase 3 ────────────────────────────────────
# rx/ry bring the camera to face the marked plane dead-on (tilt→0), but
# tilt_deg is mathematically blind to rotation AROUND the camera's own
# viewing axis — the tool can read tilt=0 and still be rolled arbitrarily
# in-frame relative to the object. Added 2026-07-28 at the user's request
# ("ถ้ากล้องมันเอียงก็หมุนแกน Rz ให้ได้ระนาบ"). Runs only after phase 2
# converges — same probe-then-converge pattern as rx/ry, just a single DOF
# against the marked region's own apparent rotation in-image (roll_deg from
# Camera.sample_plane_region_grow(), normalized into (-45,45] since a
# rectangle's orientation is only meaningful mod 90°).
ALIGN_RZ_TOL_DEG      = float(os.environ.get("ALIGN_RZ_TOL_DEG",      "2.0"))
ALIGN_RZ_GAIN         = float(os.environ.get("ALIGN_RZ_GAIN",         "0.5"))
ALIGN_RZ_MAX_STEP_DEG = float(os.environ.get("ALIGN_RZ_MAX_STEP_DEG", "5.0"))
ALIGN_RZ_MAX_ITERS    = int(os.environ.get("ALIGN_RZ_MAX_ITERS",      "20"))

# ── draw: N×M grid plane calibration + freehand path replay ────────────────
# Teach a grid of physical points (GetPose() per point, jogged by hand) on a
# flat object, then replay a freehand-drawn canvas stroke on that surface via
# piecewise-bilinear interpolation across the grid (planegrid.py). A 2×2 grid
# is exactly the simple 4-corner case; more rows/cols tolerate a surface
# that isn't perfectly flat/rectangular better than one 4-point patch (same
# idea as 3D-printer bed-leveling mesh compensation).
#
# A raw freehand mouse stroke can carry hundreds of samples — simplifying it
# (cv2.approxPolyDP) before sending robot.movl() per waypoint keeps a scribble
# from queuing an unbounded number of blocking moves. Units are normalized
# canvas fractions (0..1), not pixels or mm, since the canvas element's own
# pixel size is arbitrary.
DRAW_SIMPLIFY_EPS = float(os.environ.get("DRAW_SIMPLIFY_EPS", "0.015"))
# Hard cap on waypoints AFTER simplification (uniformly downsampled further
# if still over) — bounds how long a single draw run can take/queue.
DRAW_MAX_POINTS = int(os.environ.get("DRAW_MAX_POINTS", "60"))
# Coplanarity sanity check on the taught grid points (least-squares plane
# fit RMSE) — this is teach-accuracy noise (how precisely the points were
# jogged by hand), not vision noise, so it reuses ALIGN_MAX_RMSE_MM's spirit
# but is a separate knob since the expected error source differs.
DRAW_MAX_RMSE_MM = float(os.environ.get("DRAW_MAX_RMSE_MM", "3.0"))
DRAW_MIN_GRID_SPAN_MM = float(os.environ.get("DRAW_MIN_GRID_SPAN_MM", "5.0"))
# Soft safety cap on grid size — a fat-fingered rows/cols value shouldn't
# demand teaching 100 points by hand. Easy to raise if a real object needs
# a denser grid than this.
DRAW_GRID_MAX_ROWS = int(os.environ.get("DRAW_GRID_MAX_ROWS", "7"))
DRAW_GRID_MAX_COLS = int(os.environ.get("DRAW_GRID_MAX_COLS", "7"))
# Real queued/blended path execution (robot.Robot.movl_path()) — the
# CR5's dashboard CP() command sets a modal "smooth transition ratio"
# (corner-rounding blend radius, 1-100); sending waypoints back-to-back
# without waiting for each to finish lets the controller's own move
# queue blend them at this radius instead of stopping fully at every
# point. Kept conservative by default (light rounding) since this is
# new motion-execution code, not yet verified on real hardware, and the
# tool may be close to a real surface while drawing.
DRAW_CP_RATIO = int(os.environ.get("DRAW_CP_RATIO", "20"))
# Safety timeout for waiting on an entire queued path to finish — scales
# with waypoint count (max(STABLE_TIMEOUT, points * this)) since a
# single fixed STABLE_TIMEOUT could be too short for a long stroke.
DRAW_PATH_TIMEOUT_PER_POINT_S = float(os.environ.get("DRAW_PATH_TIMEOUT_PER_POINT_S", "1.0"))

# ── draw: motion execution mode ─────────────────────────────────────────────
# "cp"    — robot.movl_path(): queued MovL bursts blended by the CR5's CP()
#           corner-rounding. Point-to-point under the hood; a low waypoint
#           count (post-simplify) visibly looks like straight segments.
# "servo" — robot.servo_stream(): true continuous "dynamic follow" motion via
#           back-to-back ServoP calls on a densely-interpolated path
#           (planegrid.densify_path()). No corner-blend/trajectory planning
#           of its own, unlike CP — smoothness comes entirely from calling it
#           often enough with closely-spaced targets. Genuinely new, added
#           2026-08-16, verified offline only — see CLAUDE.md's Draw section
#           before trusting this near real hardware/a workpiece: test with
#           the smallest grid and a short stroke first, watch closely, ready
#           to hit Stop. Switch back to "cp" here (no code change) if it
#           misbehaves on hardware.
DRAW_MOTION_MODE = os.environ.get("DRAW_MOTION_MODE", "servo").strip().lower()
# How many ServoP calls per second while streaming — the CR5's documented
# dynamic-follow calling rate is on the order of 100Hz+ (~8-10ms period);
# kept conservative by default since this execution path is unverified on
# real hardware.
DRAW_SERVOP_RATE_HZ = float(os.environ.get("DRAW_SERVOP_RATE_HZ", "50"))
# Max XYZ distance (mm) between consecutive streamed ServoP targets —
# densify_path() linearly interpolates the (already-simplified) waypoints
# down to this spacing. Smaller = smoother but more points to stream.
DRAW_SERVOP_STEP_MM = float(os.environ.get("DRAW_SERVOP_STEP_MM", "1.0"))
# Hard cap on streamed points after densify_path() (uniformly downsampled
# further if still over) — bounds worst-case stream length/duration for a
# long stroke whose simplified waypoints are far apart.
DRAW_SERVOP_MAX_STREAM_POINTS = int(os.environ.get("DRAW_SERVOP_MAX_STREAM_POINTS", "4000"))
# How often (seconds) servo_stream() polls the controller's ERROR state
# WHILE streaming — not every single call, since a dashboard round-trip on
# every ServoP tick would blow the streaming rate's timing budget.
DRAW_SERVOP_ERROR_CHECK_S = float(os.environ.get("DRAW_SERVOP_ERROR_CHECK_S", "0.25"))
# Grace period after the last streamed point before polling for actual pose
# stability — ServoP's internal following filter still has some lag
# catching up to the final commanded target.
DRAW_SERVOP_SETTLE_S = float(os.environ.get("DRAW_SERVOP_SETTLE_S", "0.5"))
# Pen-lift height (mm) inserted between separate strokes/shapes on the Draw
# canvas (planegrid._assemble_strokes()) so the tool doesn't drag across the
# surface travelling from one shape's end to the next shape's start. A
# simple +Z offset in ROBOT BASE frame — same convention as
# ALIGN_APPROACH_Z_OFFSET elsewhere in this app, not a tool-local or taught-
# plane-normal direction — which assumes the workpiece is approached from
# above (true for every other feature in this app). Re-derive as a genuine
# plane-normal offset if a grid is ever taught on a surface facing sideways
# or downward.
DRAW_LIFT_MM = float(os.environ.get("DRAW_LIFT_MM", "15.0"))

# ── home position (absolute, robot frame) ───────────────────────────────────
HOME_X  = float(os.environ.get("HOME_X",  "0.0"))
HOME_Y  = float(os.environ.get("HOME_Y",  "0.0"))
HOME_Z  = float(os.environ.get("HOME_Z",  "0.0"))
_z_surface_env = os.environ.get("Z_SURFACE", "").strip()
# Optional: only used by /api/map/grid/setz's "surface" shortcut. Leave UNSET
# until you have measured YOUR table (jog the pen down to touch it, then copy
# the Z from the pose readout) — a wrong value here drives the tool into the
# workpiece. The touch-off datum in control_robot's z_cam_calib JSON is NOT
# this value (it was measured on a calibration tag, not the drawing surface).
Z_SURFACE = float(_z_surface_env) if _z_surface_env else None
# Live surface estimate (grid/surfacez): surface_Z = pose_Z - depth + these.
# CAM_TIP_OFFSET_MM is how far the D455 sits beyond the pen tip along the tool
# axis (~1.5mm from the 2026-06-30 z_cam_calib intercept). DRAW_SURFACE_GAP_MM
# keeps the pen a hair ABOVE the measured surface - safer than nicking it.
CAM_TIP_OFFSET_MM = float(os.environ.get("CAM_TIP_OFFSET_MM", "1.5"))
DRAW_SURFACE_GAP_MM = float(os.environ.get("DRAW_SURFACE_GAP_MM", "2.0"))
HOME_RX = float(os.environ.get("HOME_RX", "0.0"))
HOME_RY = float(os.environ.get("HOME_RY", "0.0"))
HOME_RZ = float(os.environ.get("HOME_RZ", "0.0"))

# ── flask ─────────────────────────────────────────────────────────────────────
FLASK_HOST = os.environ.get("FLASK_HOST", "0.0.0.0")
FLASK_PORT = int(os.environ.get("FLASK_PORT", "5000"))

# ── misc ──────────────────────────────────────────────────────────────────────
STABLE_TIMEOUT = 20.0
STABLE_TOL     = 0.05
STABLE_WIN     = 8

# RobotMode() code → label, standard Dobot TCP-IP Remote convention — NOT
# verified against this CR5's actual firmware, best-effort display only
# (see robot.Robot.get_mode()).
ROBOT_MODE_LABELS = {
    1: "INIT", 2: "BRAKE_OPEN", 4: "DISABLED", 5: "ENABLE",
    6: "BACKDRIVE", 7: "RUNNING", 8: "RECORDING", 9: "ERROR",
    10: "PAUSE", 11: "JOG",
}
