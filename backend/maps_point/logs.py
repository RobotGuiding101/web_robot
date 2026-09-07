"""maps_point/logs.py — two independent ring-buffer logs shared across all
modules, each with its own monotonic id so the web page only fetches what
it hasn't seen yet (see main.py's /api/logs and /api/robot_logs routes):

  log(msg)       — this app's own progress messages (connect/init/align
                    steps — same text that used to just print()).
  robot_log(msg) — the RAW dashboard/move TCP traffic (every command sent
                    to the robot controller + its reply), wired in by
                    robot.py's Robot.connect().
"""
import collections
import sys
import threading
from time import time as _time

# Windows' console defaults to a legacy codepage (cp1252 etc), not UTF-8 —
# plain print(msg) raises UnicodeEncodeError the first time a log message
# contains a character outside that codepage (confirmed on hardware
# 2026-08-05: '→' "->" in _probe_align_sign's sign-learning log crashed
# the align background thread outright, right after the probe rotation had
# already been sent AND undone — so no stray physical motion resulted, but
# align silently died with no further status update, leaving the web page
# frozen on "calibrating rotation directions" forever). Reconfiguring here
# (once, at import) instead of hunting every non-ASCII character (degree
# signs, arrows, Thai text) out of every log string across the codebase —
# new log messages elsewhere would just reintroduce the same crash.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class _RingLog:
    def __init__(self, maxlen=500):
        self.buf  = collections.deque(maxlen=maxlen)  # (id, ts, msg)
        self.lock = threading.Lock()
        self.seq  = 0

    def write(self, msg: str):
        print(msg)
        with self.lock:
            self.seq += 1
            self.buf.append((self.seq, _time(), msg))

    def since(self, last_id: int):
        with self.lock:
            entries = [{"id": i, "t": t, "msg": m} for (i, t, m) in self.buf if i > last_id]
            return entries, self.seq


server_ring = _RingLog()
robot_ring  = _RingLog()

log       = server_ring.write
robot_log = robot_ring.write
