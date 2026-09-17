"""maps_point/robot.py — Dobot CR5 control.

Subset of pick_45degree.py's Robot class needed for align: connect,
enable, read pose/mode, absolute move, and the tool-frame relative rotate
used to pivot about Tool 1. No jog/pick/draw/weld motion here — out of
scope for step 1.
"""
from time import sleep, time as _time

from .dobot_api_v3 import DobotApiDashboard, DobotApiMove

from .config import (
    MOVE_SPEED, STABLE_TIMEOUT, STABLE_TOL, STABLE_WIN,
    HOME_X, HOME_Y, HOME_Z, HOME_RX, HOME_RY, HOME_RZ,
)
from .logs import log, robot_log


class RobotMoveError(Exception):
    """Raised when the CR5 controller replies to a motion command
    (MovL/RelMovLTool/RelJointMovJ) with a non-zero error code — e.g. an
    inverse-kinematics/out-of-working-area rejection. Before 2026-07-27g
    these replies were never even read: a rejected move looked identical
    to one that simply hadn't started moving yet, _wait_stable() just saw
    the pose not change within its timeout and returned as if nothing were
    wrong, and callers (do_align's convergence loop in particular) kept
    issuing more commands into the same stuck state — on hardware this
    showed up as tilt frozen at the same value for several consecutive
    "steps" in a row. Callers that can meaningfully recover (do_align,
    do_goto) catch this and report it through state.status instead of
    letting it crash the background thread silently."""
    pass


def _reply_error_code(reply):
    """First field of a Dobot TCP reply ('errCode,{...},Cmd(...);') as an
    int, or None if it couldn't be parsed (e.g. empty reply from a dropped
    connection — treated as inconclusive, not an error, since raising here
    wouldn't be actionable)."""
    try:
        return int(str(reply).split(",", 1)[0])
    except (ValueError, IndexError):
        return None


class Robot:
    def __init__(self, ip: str, dashboard_port: int = 29999, move_port: int = 30003):
        self.ip             = ip
        self.dashboard_port = int(dashboard_port)
        self.move_port      = int(move_port)
        self.dashboard      = None
        self.move           = None
        self.connected      = False
        # Which Tool/User frame absolute moves (movl/go_home/goto_pixel)
        # resolve in — user-selectable (see set_frame()). user_index=0 here
        # because HOME_X..HOME_RZ in .maps_point.env were re-taught and
        # confirmed under Coordinate=User, User:0 with the new WELD_TOOL_
        # INDEX=2 probe (2026-08-05) — this SUPERSEDES the old "User(0)
        # breaks home" finding in this folder's CLAUDE.md, which was
        # specific to the previous Tool 1 setup, not a general rule. Also
        # confirmed via toolmovedemo/check_frame.py the same day: plain
        # Tool() selection has NO effect on GetPose() on this controller at
        # all — User() is the only thing that changes the reported frame —
        # so tool_index's value doesn't affect position readings, only
        # user_index does.
        self.tool_index = 0
        self.user_index = 0

    def close(self):
        if self.dashboard:
            try: self.dashboard.close()
            except Exception: pass
            self.dashboard = None
        if self.move:
            try: self.move.close()
            except Exception: pass
            self.move = None
        self.connected = False

    def connect(self, ip: str = None, dashboard_port: int = None, move_port: int = None):
        if ip:
            self.ip = ip
        if dashboard_port is not None:
            self.dashboard_port = int(dashboard_port)
        if move_port is not None:
            self.move_port = int(move_port)
        self.close()
        try:
            self.dashboard = DobotApiDashboard(self.ip, self.dashboard_port)
            # dobot_api_v3's own send/receive logger — was previously just
            # print()ing, invisible from the web page. Route it into
            # robot_log() instead so the Robot Log panel sees the raw TCP
            # traffic; still filter out GetPose/RobotMode/GetErrorID —
            # those get polled constantly and would flood the panel.
            self.dashboard.log = lambda t: (
                None if any(k in str(t) for k in
                            ("GetPose", "RobotMode", "GetErrorID"))
                else robot_log(str(t)))
            self.move = DobotApiMove(self.ip, self.move_port)
            # DobotApiMove (port 30003, MovL/RelMovLTool/ServoP) shares the
            # same base class's log() — same swap. ServoP specifically IS
            # filtered (unlike other move commands) because servo_stream()
            # calls it back-to-back at up to ~100Hz — logging every single
            # one would flood the Robot Log panel identically to why
            # GetPose/RobotMode/GetErrorID are filtered on the dashboard
            # side above.
            self.move.log = lambda t: (
                None if "ServoP" in str(t) else robot_log(str(t)))
            self.connected = True
            log(f"  [Robot] connected  {self.ip} (dash:{self.dashboard_port}, move:{self.move_port})")
        except Exception as e:
            log(f"  [Robot] FAILED  {e}")
            self.close()

    def init_robot(self):
        if not self.connected:
            log("  Not connected"); return
        self.dashboard.ClearError()
        self.dashboard.ResetRobot()
        sleep(0.5)
        self.dashboard.PowerOn()
        sleep(2.0)
        self.dashboard.EnableRobot()
        sleep(1.0)
        self.dashboard.SpeedFactor(MOVE_SPEED)
        # Apply whatever Tool/User indices are currently selected (defaults:
        # tool_index=0, user_index=None i.e. don't touch User at all — see
        # set_frame() and the __init__ comment for why User is opt-in, not
        # forced, by default).
        self._apply_frame()
        log("  [Robot] ready")

    def set_frame(self, tool_index: int = None, user_index: int = None):
        """Change which Tool/User frame absolute moves use — pass None for
        either to leave it as-is. user_index=-1 means "stop selecting a
        User frame at all" (back to the safe default). Applies immediately
        if connected (so you can try an index and watch the next move/home
        right away), and every movl() re-applies it afterward regardless."""
        if tool_index is not None:
            self.tool_index = tool_index
        if user_index is not None:
            self.user_index = None if user_index < 0 else user_index
        log(f"  [Robot] frame set  tool={self.tool_index}  "
            f"user={'(unset)' if self.user_index is None else self.user_index}")
        if self.dashboard:
            self._apply_frame()

    def _apply_frame(self):
        self.dashboard.Tool(self.tool_index)
        if self.user_index is not None:
            self.dashboard.User(self.user_index)

    def get_pose(self) -> list:
        if not self.dashboard:
            return [0.0] * 6
        try:
            r     = self.dashboard.GetPose()
            inner = r.split("{")[1].split("}")[0]
            return [float(v) for v in inner.split(",")]
        except Exception:
            return [0.0] * 6

    def ensure_frame(self):
        """Re-assert the selected Tool/User frame on the dashboard right
        now — call this before a get_pose() read that FEEDS INTO a
        calculation (e.g. motion.goto_pixel()'s target computation), not
        on every get_pose() call. GetPose() reports position relative to
        whatever Tool frame is CURRENTLY active on the dashboard, and
        rel_movl_tool(tool=N) is already known to change that active
        selection as a side effect (see the RelMovLTool gotcha). Without
        calling this first, goto_pixel() could read X/Y/Z in the PROBE
        TIP's frame (Tool 1, left over from align's last rotation) and
        compute a target off by the whole tool-offset distance — on
        hardware 2026-07-27h this produced a ~107mm/156° jump and then an
        IK-rejection freeze.

        This was ORIGINALLY implemented inside get_pose() itself (calling
        _apply_frame() on every single read), which caused a WORSE
        regression on 2026-07-28h: get_pose() is polled continuously by
        _wait_stable() during every move (dozens of times) and by
        /api/status every ~700ms from the browser — re-issuing Tool()/
        User() dashboard commands that often, including many times per
        second WHILE a motion was actively executing, silently stalled
        the robot's move queue entirely: no error, RobotMode() still
        reported RUNNING, but the commanded motion just never happened.
        Call this explicitly only at the specific call site that needs
        the guarantee, never from inside get_pose()."""
        if self.dashboard:
            self._apply_frame()

    def get_mode(self):
        """Current RobotMode() code, or None if unavailable. Code→label
        mapping (config.ROBOT_MODE_LABELS) is the standard Dobot TCP-IP
        Remote convention — NOT verified against this specific CR5's
        firmware, so it's shown as a best-effort label alongside the raw
        number, not trusted on its own."""
        if not self.dashboard:
            return None
        try:
            r     = self.dashboard.RobotMode()
            inner = r.split("{")[1].split("}")[0]
            return int(inner)
        except Exception:
            return None

    def _check_reply(self, reply, cmd_desc: str):
        """Raise RobotMoveError if the controller's reply carries a
        non-zero error code — see RobotMoveError's docstring for why this
        matters (a rejected move used to be indistinguishable from one
        that just hadn't finished yet)."""
        code = _reply_error_code(reply)
        if code is not None and code != 0:
            try:
                err_id = self.dashboard.GetErrorID()
            except Exception:
                err_id = "?"
            log(f"  [Robot] MOVE REJECTED  {cmd_desc}  reply={reply!r}  GetErrorID={err_id}")
            raise RobotMoveError(f"{cmd_desc} rejected (code {code}): {reply!r}")

    def movl(self, x, y, z, rx, ry, rz, speed=None):
        if not self.move: return
        # Re-assert the selected Tool (and User, if set) before every
        # absolute move — init_robot() already applies them once at
        # startup on the assumption that RelMovLTool(tool=N) (used by
        # align's rotation) resolves its own frame per-call WITHOUT
        # changing what's active on the dashboard — that assumption was
        # never verified on hardware and turned out to be WRONG: on
        # 2026-07-25b, 'home' worked correctly before running align, then
        # landed at the wrong spot after align had called
        # RelMovLTool(tool=WELD_TOOL_INDEX) — i.e. the active Tool frame
        # really did change. Cheap enough to just force it every time
        # rather than trust it stayed put.
        self._apply_frame()
        self.dashboard.SpeedFactor(speed or MOVE_SPEED)
        reply = self.move.MovL(x, y, z, rx, ry, rz)
        self._check_reply(reply, f"MovL({x:.1f},{y:.1f},{z:.1f},{rx:.1f},{ry:.1f},{rz:.1f})")
        self._wait_stable()

    def movj(self, x, y, z, rx, ry, rz, speed=None):
        """Move to Cartesian pose (x, y, z, rx, ry, rz) via Joint interpolation (point-to-point)."""
        if not self.move: return
        self._apply_frame()
        self.dashboard.SpeedFactor(speed or MOVE_SPEED)
        reply = self.move.MovJ(x, y, z, rx, ry, rz)
        self._check_reply(reply, f"MovJ({x:.1f},{y:.1f},{z:.1f},{rx:.1f},{ry:.1f},{rz:.1f})")
        self._wait_stable()

    def joint_movj(self, j1=0.0, j2=0.0, j3=0.0, j4=0.0, j5=0.0, j6=0.0, speed=None):
        """Move directly to absolute joint angles [J1..J6]."""
        if not self.move: return
        self.dashboard.SpeedFactor(speed or MOVE_SPEED)
        reply = self.move.JointMovJ(j1, j2, j3, j4, j5, j6)
        self._check_reply(reply, f"JointMovJ({j1:.2f},{j2:.2f},{j3:.2f},{j4:.2f},{j5:.2f},{j6:.2f})")
        self._wait_stable()

    def set_cp(self, ratio: int):
        """Set the modal 'smooth transition ratio' (CP — corner-rounding
        blend radius, 1-100 per the controller's protocol) used by
        subsequent movl_queued()/movl_path() calls. Dashboard-level
        setting (port 29999), same modal pattern as SpeedFactor()."""
        if not self.dashboard: return
        self.dashboard.CP(ratio)

    def movl_queued(self, x, y, z, rx, ry, rz):
        """Send an absolute MovL WITHOUT waiting for it to finish (no
        _wait_stable()) — for a BURST of calls meant to blend together
        via a prior set_cp(), see movl_path(). Deliberately does NOT call
        _apply_frame() like movl() does: re-issuing Tool()/User()
        dashboard commands WHILE a motion is actively executing on the
        move port is already known to silently stall the CR5's move
        queue (see the get_pose()/ensure_frame() gotcha in CLAUDE.md —
        the exact same class of failure). Callers doing a burst must
        _apply_frame() ONCE before starting it (movl_path() does this).
        Still checks THIS call's own immediate reply for a rejection
        code — that part is safe per-call, it's only the stability-poll
        that's skipped here, not error detection (a rejection can also
        only surface later once the controller actually tries to execute
        a queued point — the final wait in movl_path() is the backstop
        for that, same as everywhere else in this app)."""
        if not self.move: return
        reply = self.move.MovL(x, y, z, rx, ry, rz)
        self._check_reply(reply, f"MovL(queued {x:.1f},{y:.1f},{z:.1f},{rx:.1f},{ry:.1f},{rz:.1f})")

    def movl_path(self, poses: list, cp: int, speed=None,
                   timeout: float = STABLE_TIMEOUT, stop_check=None):
        """Move through a sequence of absolute [X,Y,Z,Rx,Ry,Rz] poses as
        ONE continuously-blended motion, using the CR5's own queued-move
        execution plus CP() corner-rounding — real queued/blended motion
        instead of point-to-point stop-and-settle at every waypoint (see
        planegrid.do_draw(), the caller). Applies the selected Tool/User
        frame and the CP ratio ONCE before the burst (not per-waypoint —
        see movl_queued()'s docstring for why), sends every waypoint
        back-to-back with no stability wait between them, then waits ONCE
        for the whole path to settle.

        stop_check: optional zero-arg callable returning True to abort
        early. Deliberately a plain callable, not any app-specific state
        object — robot.py stays free of app-level coupling (see the
        architecture's one-way import direction in CLAUDE.md). On a stop
        request this calls clear_error() (ClearError()+ResetRobot(),
        already used elsewhere in this file for recovery — ResetRobot()
        is the documented "robot stop" command) to actually halt the
        queued motion, not just abandon the Python-side wait and leave
        the controller still executing an already-queued burst
        unattended — that gap would make Stop a UI illusion, not a real
        abort.

        Raises RobotMoveError if any waypoint's reply is rejected
        (checked as each one is sent, so a mid-burst rejection stops
        queueing further points immediately) or if the controller enters
        its ERROR state during the final wait (same _raise_if_error()
        backstop _wait_stable() uses elsewhere — a rejection can surface
        only once the controller actually tries to execute a queued
        point, not necessarily at submission time).

        NOTE: this duplicates _wait_stable()'s settle-polling logic
        rather than extending it — _wait_stable() is used by many
        existing single-move call sites (align, jog, goto) that have
        never needed a stop_check hook; adding one there for this one
        new use would be unnecessary scope creep on well-tested code."""
        if not self.move or not poses: return
        self._apply_frame()
        self.dashboard.SpeedFactor(speed or MOVE_SPEED)
        self.set_cp(cp)
        for x, y, z, rx, ry, rz in poses:
            if stop_check and stop_check():
                # Anything already queued before this check tripped is
                # still real motion sitting in the controller's queue —
                # must halt it too, not just stop sending more (same
                # "don't leave it running unattended" reasoning as the
                # wait-loop's stop branches below). Harmless no-op if
                # nothing was queued yet, so unconditional is simplest.
                self.clear_error()
                return
            self.movl_queued(x, y, z, rx, ry, rz)

        start    = self.get_pose()
        sleep(0.3)
        self._raise_if_error()
        deadline = _time() + timeout
        ph1_end  = min(deadline, _time() + 3.0)
        moving   = False
        while _time() < ph1_end:
            if stop_check and stop_check():
                self.clear_error(); return
            cur = self.get_pose()
            if max(abs(cur[i] - start[i]) for i in range(6)) > STABLE_TOL * 5:
                moving = True; break
            sleep(0.05)
        self._raise_if_error()
        if not moving: return
        hist: list = []
        while _time() < deadline:
            if stop_check and stop_check():
                self.clear_error(); return
            self._raise_if_error()
            pose = self.get_pose()
            hist.append(pose)
            if len(hist) > STABLE_WIN: hist.pop(0)
            if len(hist) == STABLE_WIN:
                settled = all(
                    max(h[i] for h in hist) - min(h[i] for h in hist) < STABLE_TOL
                    for i in range(6))
                if settled:
                    sleep(0.2); return
            sleep(0.1)

    def servo_p(self, x, y, z, rx, ry, rz):
        """Send one ServoP dynamic-follow target WITHOUT waiting — meant to
        be called back-to-back at a fixed high rate by servo_stream(), not
        used standalone. Unlike movl_queued()/MovL, ServoP has no queue or
        corner-blend of its own: smoothness comes entirely from calling it
        often enough with closely-spaced targets, not from anything the
        controller does between calls. Still checks the reply for a
        rejection code (cheap, per-call, same as movl_queued())."""
        if not self.move: return
        reply = self.move.ServoP(x, y, z, rx, ry, rz)
        self._check_reply(reply, f"ServoP({x:.1f},{y:.1f},{z:.1f},{rx:.1f},{ry:.1f},{rz:.1f})")

    def servo_stream(self, poses: list, hz: float, settle_s: float = 0.5,
                      error_check_interval: float = 0.25,
                      timeout: float = STABLE_TIMEOUT, stop_check=None):
        """Stream a DENSE path of [X,Y,Z,Rx,Ry,Rz] poses as one continuous
        motion via back-to-back ServoP calls at a fixed rate `hz` — the
        CR5's Cartesian "dynamic follow" mode, genuinely continuous motion
        rather than movl_path()'s queued-MovL-plus-CP-blend (see
        CLAUDE.md's Draw section for why these are different execution
        models, not two ways of doing the same thing). `poses` must
        already be densely interpolated with small spacing between
        consecutive points (planegrid.densify_path()) — ServoP has no
        trajectory planning of its own, so a sparse path streamed this way
        would jerk badly, worse than movl_path()'s CP blending.

        Applies the selected Tool/User frame ONCE before streaming starts,
        never mid-stream — same reasoning as movl_path()/movl_queued()
        (re-issuing Tool()/User() while motion is executing is already
        known to silently stall the CR5's move queue, see CLAUDE.md).

        Only polls the controller's ERROR state every `error_check_interval`
        seconds, not every single call — a dashboard round-trip on every
        ServoP tick would blow the timing budget at typical streaming
        rates and defeat the point of streaming in the first place.

        stop_check (plain zero-arg callable, same contract as
        movl_path()'s) and a detected controller error both end the stream
        by calling clear_error() (ResetRobot()) so anything already
        in-flight actually halts, not just stops sending more — same "stop
        must actually stop, not just stop queueing" reasoning as
        movl_path().

        After the last streamed point, ServoP's internal following filter
        still has some lag catching up to the final target — sleeps
        `settle_s` first, then polls actual pose stability (own copy of
        _wait_stable()'s polling logic, same reasoning as movl_path() for
        not extending the shared one: needs a stop_check hook the existing
        single-move call sites never needed)."""
        if not self.move or not poses: return
        self._apply_frame()
        period     = 1.0 / hz
        next_check = _time()
        for x, y, z, rx, ry, rz in poses:
            t0 = _time()
            if stop_check and stop_check():
                self.clear_error(); return
            if t0 >= next_check:
                self._raise_if_error()
                next_check = t0 + error_check_interval
            self.servo_p(x, y, z, rx, ry, rz)
            remaining = period - (_time() - t0)
            if remaining > 0:
                sleep(remaining)

        if stop_check and stop_check():
            self.clear_error(); return
        sleep(settle_s)
        self._raise_if_error()
        deadline = _time() + timeout
        hist: list = []
        while _time() < deadline:
            if stop_check and stop_check():
                self.clear_error(); return
            self._raise_if_error()
            pose = self.get_pose()
            hist.append(pose)
            if len(hist) > STABLE_WIN: hist.pop(0)
            if len(hist) == STABLE_WIN:
                settled = all(
                    max(h[i] for h in hist) - min(h[i] for h in hist) < STABLE_TOL
                    for i in range(6))
                if settled:
                    return
            sleep(0.1)

    def rel_movl_tool(self, dx, dy, dz, tool=0, drx=0.0, dry=0.0, drz=0.0):
        """Move by (dx,dy,dz,drx,dry,drz) in tool frame `tool`'s own axes —
        the controller resolves rotation using the CURRENT orientation.
        Align calls this with dx=dy=dz=0, tool=WELD_TOOL_INDEX (Tool 1) so
        only orientation changes, pivoting about the probe tip."""
        if not self.move: return
        reply = self.move.RelMovLTool(dx, dy, dz, drx, dry, drz, tool)
        self._check_reply(reply, f"RelMovLTool(d={dx:.2f},{dy:.2f},{dz:.2f} "
                                  f"tool={tool} drx={drx:.2f} dry={dry:.2f} drz={drz:.2f})")
        self._wait_stable()

    def jog_cartesian(self, dx=0.0, dy=0.0, dz=0.0, drx=0.0, dry=0.0, drz=0.0):
        """Manual XYZ/RxRyRz jog, one small step — reuses rel_movl_tool()
        in whichever Tool frame is currently selected (self.tool_index),
        so jogging pivots the same way align's rotation does if you've
        pointed tool_index at Tool 1 (see set_frame())."""
        self.rel_movl_tool(dx, dy, dz, tool=self.tool_index, drx=drx, dry=dry, drz=drz)

    def jog_joint(self, j1=0.0, j2=0.0, j3=0.0, j4=0.0, j5=0.0, j6=0.0):
        """Manual joint-space jog — one axis at a time in practice (the
        web page only ever sends one non-zero offset per call), but takes
        all 6 so a future combined move is trivial to add."""
        if not self.move: return
        reply = self.move.RelJointMovJ(j1, j2, j3, j4, j5, j6)
        self._check_reply(reply, f"RelJointMovJ({j1},{j2},{j3},{j4},{j5},{j6})")
        self._wait_stable()

    def get_angle(self) -> list:
        if not self.dashboard:
            return [0.0] * 6
        try:
            r     = self.dashboard.GetAngle()
            inner = r.split("{")[1].split("}")[0]
            return [float(v) for v in inner.split(",")]
        except Exception:
            return [0.0] * 6

    def go_home(self):
        if not self.move: return
        if not any([HOME_X, HOME_Y, HOME_Z]):
            log("  HOME not set — add HOME_X/Y/Z/RX/RY/RZ to .maps_point.env"); return
        self.movl(HOME_X, HOME_Y, HOME_Z, HOME_RX, HOME_RY, HOME_RZ)

    def disable_robot(self):
        if not self.dashboard: return
        self.dashboard.ClearError()
        self.dashboard.ResetRobot()
        sleep(0.5)
        self.dashboard.DisableRobot()
        self.connected = False

    def clear_error(self):
        if not self.dashboard: return
        self.dashboard.ClearError()
        self.dashboard.ResetRobot()

    def emergency_stop(self):
        """Immediately halt robot motion and abort queued commands."""
        log("  [EMERGENCY] Emergency stop triggered!")
        if not self.dashboard:
            return
        try:
            self.dashboard.ResetRobot()
        except Exception as e:
            log(f"  [EMERGENCY] ResetRobot failed: {e}")
        try:
            self.dashboard.EmergencyStop()
        except Exception as e:
            log(f"  [EMERGENCY] EmergencyStop failed: {e}")

    def _raise_if_error(self):
        """Poll RobotMode() for the controller's ERROR state (code 9, the
        standard Dobot TCP-IP Remote convention — see config.
        ROBOT_MODE_LABELS, not independently verified against this CR5's
        firmware but the best signal available). This is the backstop for
        failures _check_reply() can't see: a move command's own immediate
        reply can say "0" (accepted/queued) even when the motion itself
        gets rejected a moment later once the controller actually tries to
        execute it (e.g. an IK/out-of-working-area violation) — on
        hardware 2026-07-27h a run hit exactly this: every RelMovLTool
        reply looked fine, no RobotMoveError ever fired from
        _check_reply(), yet the robot was frozen and unresponsive for the
        rest of the run. Called during _wait_stable() so any move that
        trips the alarm gets caught right after issuing it, not
        discovered several silently-stuck steps later."""
        if not self.dashboard:
            return
        if self.get_mode() == 9:
            try:
                err_id = self.dashboard.GetErrorID()
            except Exception:
                err_id = "?"
            log(f"  [Robot] CONTROLLER ERROR STATE  RobotMode=9 (ERROR)  GetErrorID={err_id}")
            raise RobotMoveError(f"controller entered ERROR state (RobotMode=9): GetErrorID={err_id}")

    def _wait_stable(self, timeout=STABLE_TIMEOUT, tol=STABLE_TOL):
        """Watches the FULL 6-DOF pose (position AND orientation), not just
        XYZ. A pure Rx/Ry/Rz jog or a pure J6 (wrist) joint jog can leave
        XYZ completely unchanged — checking XYZ alone would then never see
        "moving" and return immediately, before the rotation actually
        finished. tol is reused as the threshold for both mm and degrees;
        it's small enough (0.05) to work as a reasonable "settled"
        threshold either way without adding a second config knob."""
        start    = self.get_pose()
        sleep(0.3)
        self._raise_if_error()
        deadline = _time() + timeout
        ph1_end  = min(deadline, _time() + 3.0)
        moving   = False
        while _time() < ph1_end:
            cur = self.get_pose()
            if max(abs(cur[i] - start[i]) for i in range(6)) > tol * 5:
                moving = True; break
            sleep(0.05)
        self._raise_if_error()
        if not moving: return
        hist: list = []
        while _time() < deadline:
            self._raise_if_error()
            pose = self.get_pose()
            hist.append(pose)
            if len(hist) > STABLE_WIN: hist.pop(0)
            if len(hist) == STABLE_WIN:
                settled = all(
                    max(h[i] for h in hist) - min(h[i] for h in hist) < tol
                    for i in range(6))
                if settled:
                    sleep(0.2); return
            sleep(0.1)