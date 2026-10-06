"""Unit tests for Robot.pose_source_report — the read-only diagnostic that
decides whether this controller exposes a live pose at all.

Calls the unbound method with a stub so nothing touches a socket, and
compresses the real sleep so the suite stays fast.
"""
import pytest

from maps_point import robot as robot_mod


class _Stub:
    """Stands in for Robot; pose_source_report only ever calls these two."""

    def __init__(self, poses, angles):
        self._poses = poses
        self._angles = angles
        self._pn = 0
        self._an = 0

    def get_pose(self):
        pose = self._poses[min(self._pn, len(self._poses) - 1)]
        self._pn += 1
        return list(pose)

    def get_angle(self):
        # Separate counter: pose_source_report interleaves the two reads, so a
        # shared one would walk the angle series at double speed.
        angle = self._angles[min(self._an, len(self._angles) - 1)]
        self._an += 1
        return list(angle)


def _report(poses, angles, monkeypatch):
    monkeypatch.setattr(robot_mod, "sleep", lambda _s: None)
    stub = _Stub(poses, angles)
    return robot_mod.Robot.pose_source_report(stub, samples=len(poses), interval=0)


P1 = [1.0, 2.0, 3.0, 0.0, 0.0, 0.0]
P2 = [1.5, 2.5, 3.5, 0.0, 0.0, 0.0]
A1 = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0]
A2 = [10.1, 20.1, 30.1, 40.1, 50.1, 60.1]


class TestPoseSourceReport:
    def test_command_echo_pose_with_live_angles(self, monkeypatch):
        # The case the 2026-10-06 run hit: GetPose repeats the commanded
        # target exactly while the encoders keep moving.
        out = _report([P1, P1, P1, P1], [A1, A2, A1, A2], monkeypatch)
        assert out["verdict"] == "get_pose_is_command_echo__use_joint_angles"
        assert out["get_pose_varies"] is False
        assert out["get_angles_vary"] is True

    def test_pose_is_live_when_only_it_moves(self, monkeypatch):
        out = _report([P1, P2, P1, P2], [A1, A1, A1, A1], monkeypatch)
        assert out["verdict"] == "get_pose_is_live"
        assert out["get_pose_varies"] is True
        assert out["get_angles_vary"] is False

    def test_both_live(self, monkeypatch):
        out = _report([P1, P2, P1, P2], [A1, A2, A1, A2], monkeypatch)
        assert out["verdict"] == "both_live"

    def test_neither_varies_means_no_feedback_at_all(self, monkeypatch):
        out = _report([P1, P1, P1, P1], [A1, A1, A1, A1], monkeypatch)
        assert out["verdict"] == "neither_varies__controller_reports_commands_only"
        assert out["get_pose_varies"] is False
        assert out["get_angles_vary"] is False

    def test_returns_every_sample_it_took(self, monkeypatch):
        poses = [P1, P1, P2, P1, P2]
        out = _report(poses, [A1] * 5, monkeypatch)
        assert out["pose_samples"] == poses
        assert len(out["angle_samples"]) == 5

    def test_jitter_below_printing_precision_still_counts_as_varying(self, monkeypatch):
        # The controller prints its values, so two readings that differ only
        # past the printed precision must not be mistaken for a frozen value.
        out = _report([[1.0, 2.0, 3.0, 0, 0, 0], [1.0, 2.0, 3.0, 0, 0, 0.0000001]],
                      [A1, A1], monkeypatch)
        assert out["get_pose_varies"] is True

    def test_never_raises_when_the_dashboard_is_absent(self, monkeypatch):
        monkeypatch.setattr(robot_mod, "sleep", lambda _s: None)
        dead = type("Dead", (), {"get_pose": lambda s: [0.0] * 6,
                                  "get_angle": lambda s: [0.0] * 6})()
        out = robot_mod.Robot.pose_source_report(dead, samples=3, interval=0)
        assert out["get_pose_varies"] is False