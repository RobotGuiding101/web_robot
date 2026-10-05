"""Unit tests for maps_point.planegrid — pure geometry / interpolation math.

These functions are the safest, highest-value things to unit test: no camera,
no robot, no sockets — just arithmetic on taught poses.
"""
import math

import pytest

from maps_point import planegrid as pg
from maps_point.config import DRAW_MAX_POINTS

# 2x2 grid: row 0 = top, col 0 = left. Layout grid_points[i][j].
P00 = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
P10 = [10.0, 0.0, 0.0, 0.0, 0.0, 0.0]
P01 = [0.0, 10.0, 0.0, 0.0, 0.0, 0.0]
P11 = [10.0, 10.0, 0.0, 0.0, 0.0, 0.0]
GRID2 = [[P00, P10], [P01, P11]]


class TestBilinearCell:
    def test_corners_return_corner_pose(self):
        assert pg.bilinear_cell(0, 0, P00, P10, P01, P11) == P00
        assert pg.bilinear_cell(1, 0, P00, P10, P01, P11) == P10
        assert pg.bilinear_cell(0, 1, P00, P10, P01, P11) == P01
        assert pg.bilinear_cell(1, 1, P00, P10, P01, P11) == P11

    def test_center_is_average_of_corners(self):
        mid = pg.bilinear_cell(0.5, 0.5, P00, P10, P01, P11)
        assert mid == [5.0, 5.0, 0.0, 0.0, 0.0, 0.0]

    def test_affine_interpolation_stays_on_taught_plane(self):
        # corners lie exactly on the plane z = x + y; any bilinear point must too
        a = [0.0, 0.0, 0.0, 0, 0, 0]
        b = [1.0, 0.0, 1.0, 0, 0, 0]
        c = [0.0, 1.0, 1.0, 0, 0, 0]
        d = [1.0, 1.0, 2.0, 0, 0, 0]
        for (lu, lv) in [(0.25, 0.5), (0.7, 0.1), (0.9, 0.9)]:
            x, y, z = pg.bilinear_cell(lu, lv, a, b, c, d)[:3]
            assert z == pytest.approx(x + y)


class TestGridPose:
    def test_clamps_and_maps_corners(self):
        assert pg.grid_pose(0.0, 0.0, GRID2, 2, 2) == P00
        assert pg.grid_pose(1.0, 1.0, GRID2, 2, 2) == P11
        # out of range clamps instead of extrapolating
        assert pg.grid_pose(-5.0, -5.0, GRID2, 2, 2) == P00
        assert pg.grid_pose(9.0, 9.0, GRID2, 2, 2) == P11

    def test_center_of_2x2(self):
        assert pg.grid_pose(0.5, 0.5, GRID2, 2, 2) == [5.0, 5.0, 0.0, 0.0, 0.0, 0.0]

    def test_3x3_cell_interpolation(self):
        # 3x3 grid on z = x*10 + y, verify a point inside the middle cell
        rows = cols = 3
        grid = [
            [[float(j) * 10.0, float(i) * 10.0, float(j) * 100.0 + float(i) * 10.0, 0, 0, 0]
             for j in range(cols)]
            for i in range(rows)
        ]
        # u=v=0.5 -> global col_f=1.0, row_f=1.0 -> exact centre node
        assert pg.grid_pose(0.5, 0.5, grid, rows, cols) == grid[1][1]


class TestValidateGrid:
    def test_flat_grid_has_no_warnings(self):
        res = pg.validate_grid(GRID2, 2, 2)
        assert res["rmse_mm"] == pytest.approx(0.0, abs=1e-9)
        assert res["span_mm"] == pytest.approx(10.0)
        assert res["warnings"] == []

    def test_tiny_span_warns(self):
        tiny = [[[1.0, 1.0, 1.0, 0, 0, 0], [1.0, 1.0, 1.0, 0, 0, 0]],
                [[1.0, 1.0, 1.0, 0, 0, 0], [1.0, 1.0, 1.0, 0, 0, 0]]]
        res = pg.validate_grid(tiny, 2, 2)
        assert res["span_mm"] == 0.0
        assert any("no size" in w for w in res["warnings"])

    def test_non_coplanar_warns_on_rmse(self):
        # a 100mm square with one corner lifted 100mm — a plane can't absorb it
        warped = [[[0.0, 0.0, 0.0, 0, 0, 0], [100.0, 0.0, 0.0, 0, 0, 0]],
                  [[0.0, 100.0, 0.0, 0, 0, 0], [100.0, 100.0, 100.0, 0, 0, 0]]]
        res = pg.validate_grid(warped, 2, 2)
        assert res["rmse_mm"] > pg.DRAW_MAX_RMSE_MM
        assert any("coplanar" in w for w in res["warnings"])


class TestProjectGrid2d:
    def test_shape_and_orientation(self):
        pts = pg.project_grid_2d(GRID2, 2, 2)
        assert len(pts) == 2 and all(len(r) == 2 for r in pts)
        assert all(isinstance(v, float) for row in pts for pair in row for v in pair)
        # col grows -> u grows ; row grows -> v grows (sign-flip logic)
        assert pts[1][1][0] > pts[0][0][0]
        assert pts[1][1][1] > pts[0][0][1]


class TestCapPoints:
    def test_under_cap_is_unchanged(self):
        pts = [(0.0, 0.0), (1.0, 1.0)]
        assert pg._cap_points(pts, 5) == [(0.0, 0.0), (1.0, 1.0)]

    def test_over_cap_downsampled_preserving_endpoints(self):
        pts = [(i / 10.0, 0.0) for i in range(11)]
        out = pg._cap_points(pts, 3)
        assert len(out) == 3
        assert out[0] == (0.0, 0.0)
        assert out[-1] == (1.0, 0.0)


class TestDensifyPath:
    def test_straight_segment_is_subdivided_by_step(self):
        poses = [[0.0, 0.0, 0.0, 0.0, 0.0, 0.0], [9.0, 0.0, 0.0, 0.0, 0.0, 0.0]]
        out = pg.densify_path(poses, 3.0, 100)
        xs = [p[0] for p in out]
        assert xs == [0.0, 3.0, 6.0, 9.0]

    def test_rotation_interpolated_along_position(self):
        poses = [[0.0, 0.0, 0.0, 10.0, 0.0, 0.0], [6.0, 0.0, 0.0, 16.0, 0.0, 0.0]]
        out = pg.densify_path(poses, 3.0, 100)
        assert out[1][3] == pytest.approx(13.0)   # midpoint rotation
        assert out[-1] == [6.0, 0.0, 0.0, 16.0, 0.0, 0.0]

    def test_respects_max_points_cap(self):
        poses = [[0.0, 0.0, 0.0, 0, 0, 0], [1000.0, 0.0, 0.0, 0, 0, 0]]
        out = pg.densify_path(poses, 0.5, 50)
        assert len(out) == 50
        assert out[0][0] == 0.0 and out[-1][0] == 1000.0

    def test_single_pose_returns_copy(self):
        one = [[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]]
        out = pg.densify_path(one, 1.0, 10)
        assert out == one and out is not one


class TestSimplifyStroke:
    def test_two_or_fewer_points_untouched(self):
        assert pg.simplify_stroke([(0.1, 0.1)]) == [(0.1, 0.1)]
        pts = [(0.1, 0.1), (0.2, 0.2)]
        assert pg.simplify_stroke(pts) == pts

    def test_short_stroke_is_not_collapsed(self):
        # 20 samples on a curve must survive (a regression: DP used to collapse
        # short strokes to a 2-point straight line)
        pts = [(math.cos(t / 10.0) * 0.4 + 0.5, math.sin(t / 10.0) * 0.4 + 0.5)
               for t in range(20)]
        out = pg.simplify_stroke(pts)
        assert len(out) > 2
        assert len(out) <= DRAW_MAX_POINTS

    def test_long_stroke_is_bounded(self):
        pts = [(i / 500.0, (i % 7) / 50.0) for i in range(501)]
        out = pg.simplify_stroke(pts)
        assert 2 <= len(out) <= DRAW_MAX_POINTS

    def test_long_straight_line_never_returns_under_two_points(self):
        pts = [(i / 500.0, 0.0) for i in range(501)]
        out = pg.simplify_stroke(pts)
        assert len(out) >= 2 and len(out) <= DRAW_MAX_POINTS


class TestDrawStats:
    """draw_stats feeds the experiment record's stroke/point-count columns, so
    its totals must agree with the functions do_draw() actually replays."""

    def test_counts_match_simplify_for_pen_stroke(self):
        pts = [(i / 200.0, 0.0) for i in range(201)]
        out = pg.draw_stats([{"tool": "pen", "points": pts}], GRID2, 2, 2, 5.0)
        assert out["strokes"] == 1
        assert out["points_before"] == 201
        assert out["points_after"] == len(pg.simplify_stroke(pts))

    def test_shape_stroke_is_not_simplified(self):
        square = [(0.1, 0.1), (0.4, 0.1), (0.4, 0.4), (0.1, 0.4)]
        out = pg.draw_stats([{"tool": "rect", "points": square}], GRID2, 2, 2, 5.0)
        assert out["points_after"] == 4

    def test_totals_sum_across_strokes(self):
        a = [(i / 60.0, 0.0) for i in range(61)]
        b = [(0.0, i / 60.0) for i in range(61)]
        one_a = pg.draw_stats([{"tool": "pen", "points": a}], GRID2, 2, 2, 5.0)
        one_b = pg.draw_stats([{"tool": "pen", "points": b}], GRID2, 2, 2, 5.0)
        out = pg.draw_stats([{"tool": "pen", "points": a},
                             {"tool": "pen", "points": b}], GRID2, 2, 2, 5.0)
        assert out["strokes"] == 2
        assert out["points_before"] == 122
        assert out["points_after"] == one_a["points_after"] + one_b["points_after"]

    def test_path_length_is_positive_for_a_real_stroke(self):
        out = pg.draw_stats([{"tool": "line", "points": [(0.0, 0.0), (1.0, 1.0)]}],
                            GRID2, 2, 2, 5.0)
        assert out["path_length_mm"] > 0
        assert out["waypoints"] >= 2

    def test_single_stroke_has_no_lift_transition(self):
        out = pg.draw_stats([{"tool": "line", "points": [(0.0, 0.0), (1.0, 0.0)]}],
                            GRID2, 2, 2, 5.0)
        assert out["lift_transitions"] == 0

    def test_reports_execution_settings_from_config(self):
        out = pg.draw_stats([{"tool": "line", "points": [(0.0, 0.0), (1.0, 0.0)]}],
                            GRID2, 2, 2, 7.0)
        assert out["motion_mode"] == pg.DRAW_MOTION_MODE
        assert out["cp_ratio"] == pg.DRAW_CP_RATIO
        assert out["lift_mm"] == 7.0


CLOSED_RECT = [(0.1, 0.1), (0.4, 0.1), (0.4, 0.4), (0.1, 0.4), (0.1, 0.1)]


class TestDrawStatsShapeDetail:
    """The 2026-10-05 report showed five strokes with uv_start == uv_end and
    nothing to say whether that meant five closed rectangles or five corrupt
    records. These fields are what make the report self-verifying."""

    def test_closed_rectangle_is_flagged_closed(self):
        out = pg.draw_stats([{"tool": "rect", "points": CLOSED_RECT}], GRID2, 2, 2, 5.0)
        assert out["per_stroke"][0]["closed"] is True

    def test_open_stroke_is_not_flagged_closed(self):
        out = pg.draw_stats([{"tool": "line", "points": [(0.0, 0.0), (1.0, 1.0)]}],
                            GRID2, 2, 2, 5.0)
        assert out["per_stroke"][0]["closed"] is False

    def test_points_uv_lists_every_replayed_point(self):
        out = pg.draw_stats([{"tool": "rect", "points": CLOSED_RECT}], GRID2, 2, 2, 5.0)
        assert out["per_stroke"][0]["points_uv"] == [
            [round(u, 4), round(v, 4)] for u, v in CLOSED_RECT]

    def test_length_mm_is_the_closed_perimeter_not_the_diagonal(self):
        out = pg.draw_stats([{"tool": "rect", "points": CLOSED_RECT}], GRID2, 2, 2, 5.0)
        entry = out["per_stroke"][0]
        # 3x3mm corners on a 10mm grid: four 3mm sides, and the duplicated
        # closing vertex adds nothing because it coincides with the first.
        assert entry["length_mm"] == pytest.approx(12.0, abs=0.01)
        assert entry["span_mm"] == {"x": 3.0, "y": 3.0, "z": 0.0}

    def test_drawn_length_excludes_the_lift_hops_that_travel_includes(self):
        strokes = [{"tool": "rect", "points": CLOSED_RECT},
                   {"tool": "rect", "points": [(0.6, 0.6), (0.9, 0.6),
                                               (0.9, 0.9), (0.6, 0.9), (0.6, 0.6)]}]
        out = pg.draw_stats(strokes, GRID2, 2, 2, 5.0)
        assert out["drawn_path_length_mm"] < out["total_travel_mm"]
        assert out["path_length_mm"] == out["total_travel_mm"]

    def test_drawn_length_sums_the_per_stroke_lengths(self):
        strokes = [{"tool": "rect", "points": CLOSED_RECT},
                   {"tool": "rect", "points": [(0.6, 0.6), (0.9, 0.6),
                                               (0.9, 0.9), (0.6, 0.9), (0.6, 0.6)]}]
        out = pg.draw_stats(strokes, GRID2, 2, 2, 5.0)
        assert out["drawn_path_length_mm"] == pytest.approx(
            sum(s["length_mm"] for s in out["per_stroke"]), abs=0.02)

    def test_tool_is_reported_as_sent_not_assumed(self):
        out = pg.draw_stats([{"tool": "circle", "points": CLOSED_RECT}],
                            GRID2, 2, 2, 5.0)
        assert out["per_stroke"][0]["tool"] == "circle"

    def test_empty_stroke_gets_no_geometry_keys(self):
        out = pg.draw_stats([{"tool": "rect", "points": []}], GRID2, 2, 2, 5.0)
        entry = out["per_stroke"][0]
        assert entry["points_before"] == 0
        assert "closed" not in entry and "length_mm" not in entry


class TestStrokePath:
    def test_rect_is_not_douglas_peuckered(self):
        # The Draw page hardcoded tool:"pen" for every shape, which made
        # this branch unreachable and let a 49-point circle reach the DP
        # simplifier that _stroke_path() exists to route around.
        circle = [(0.5 + 0.4 * math.cos(i * 2 * math.pi / 48),
                   0.5 + 0.4 * math.sin(i * 2 * math.pi / 48)) for i in range(49)]
        assert len(pg._stroke_path({"tool": "circle", "points": circle})) == 49

    def test_pen_still_goes_through_simplify(self):
        pts = [(i / 500.0, 0.0) for i in range(501)]
        assert len(pg._stroke_path({"tool": "pen", "points": pts})) <= DRAW_MAX_POINTS


class TestFinalStrokeUv:
    def test_matches_the_stroke_that_produced_the_last_pose(self):
        strokes = [{"tool": "rect", "points": CLOSED_RECT}]
        poses = pg._assemble_strokes(strokes, GRID2, 2, 2, 5.0)
        assert pg._final_stroke_uv(strokes, GRID2, 2, 2) == CLOSED_RECT[-1]
        assert pg.grid_pose(*pg._final_stroke_uv(strokes, GRID2, 2, 2),
                            GRID2, 2, 2)[:3] == poses[-1][:3]

    def test_skips_a_trailing_stroke_with_no_points(self):
        # _assemble_strokes() `continue`s past an empty stroke, so
        # strokes[-1] is not necessarily the last contributor to poses.
        strokes = [{"tool": "rect", "points": CLOSED_RECT},
                   {"tool": "rect", "points": []}]
        poses = pg._assemble_strokes(strokes, GRID2, 2, 2, 5.0)
        assert pg._final_stroke_uv(strokes, GRID2, 2, 2) == CLOSED_RECT[-1]
        assert pg.grid_pose(*pg._final_stroke_uv(strokes, GRID2, 2, 2),
                            GRID2, 2, 2)[:3] == poses[-1][:3]

    def test_returns_none_when_nothing_is_drawable(self):
        assert pg._final_stroke_uv([{"tool": "rect", "points": []}], GRID2, 2, 2) is None


class TestGridFingerprint:
    def test_is_stable_for_the_same_grid(self):
        assert pg.grid_fingerprint(GRID2) == pg.grid_fingerprint([list(r) for r in GRID2])

    def test_survives_a_json_round_trip(self):
        import json
        revived = json.loads(json.dumps(GRID2))
        assert pg.grid_fingerprint(revived) == pg.grid_fingerprint(GRID2)

    def test_changes_when_the_grid_is_re_taught(self):
        moved = [[list(P00), list(P10)], [list(P01), [11.0, 10.0, 0.0, 0, 0, 0]]]
        assert pg.grid_fingerprint(moved) != pg.grid_fingerprint(GRID2)

    def test_tolerates_sub_micron_float_noise(self):
        nudged = [[list(P00), [10.0 + 1e-9, 0.0, 0.0, 0, 0, 0]],
                  [list(P01), list(P11)]]
        assert pg.grid_fingerprint(nudged) == pg.grid_fingerprint(GRID2)

    def test_handles_unmarked_corners(self):
        assert pg.grid_fingerprint([[P00, None], [None, P11]])


class TestPoseReadIsPlausible:
    def test_accepts_a_pose_on_the_grid(self):
        assert pg.pose_read_is_plausible([5.0, 5.0, 0.0, 0, 0, 0], GRID2)

    def test_accepts_a_large_but_real_error(self):
        # Guards against garbage only — a 3mm deviation must never be dropped.
        assert pg.pose_read_is_plausible([8.0, 5.0, 0.0, 0, 0, 0], GRID2)

    def test_rejects_the_get_pose_failure_sentinel(self):
        # robot.py:167 returns [0.0]*6 on ANY dashboard failure.
        assert not pg.pose_read_is_plausible([0.0] * 6, GRID2)

    def test_rejects_non_finite(self):
        assert not pg.pose_read_is_plausible([float("nan"), 5.0, 0.0], GRID2)
        assert not pg.pose_read_is_plausible([float("inf"), 5.0, 0.0], GRID2)

    def test_rejects_a_pose_far_outside_the_taught_grid(self):
        assert not pg.pose_read_is_plausible([1e6, 1e6, 1e6, 0, 0, 0], GRID2)

    def test_rejects_empty_or_short_reads(self):
        assert not pg.pose_read_is_plausible([], GRID2)
        assert not pg.pose_read_is_plausible([1.0, 2.0], GRID2)

    def test_rejects_when_nothing_has_been_taught(self):
        assert not pg.pose_read_is_plausible([1.0, 1.0, 1.0], [[None, None], [None, None]])


class TestReportMissingCodes:
    def test_nothing_missing_is_empty(self):
        fp = pg.grid_fingerprint(GRID2)
        points = [{"grid_fingerprint": fp}]
        assert pg.report_missing_codes(True, GRID2, points, {"strokes": 1}) == []

    def test_flags_an_unmarked_grid(self):
        assert "grid_not_marked" in pg.report_missing_codes(
            False, GRID2, [{"grid_fingerprint": pg.grid_fingerprint(GRID2)}], {"s": 1})

    def test_flags_no_test_points(self):
        assert "no_test_points" in pg.report_missing_codes(True, GRID2, [], {"s": 1})

    def test_flags_no_draw_stats(self):
        fp = pg.grid_fingerprint(GRID2)
        codes = pg.report_missing_codes(True, GRID2, [{"grid_fingerprint": fp}], {})
        assert codes == ["no_draw_stats"]

    def test_flags_a_grid_re_taught_after_measuring(self):
        stale = {"grid_fingerprint": "deadbeef"}
        codes = pg.report_missing_codes(True, GRID2, [stale], {"strokes": 1})
        assert codes == ["grid_changed_since_test"]

    def test_reports_every_gap_at_once(self):
        codes = pg.report_missing_codes(False, GRID2, [], {})
        assert set(codes) == {"grid_not_marked", "no_test_points", "no_draw_stats"}

    def test_staleness_is_not_reported_when_draw_is_missing(self):
        # Otherwise a fresh, untouched session would look like it had
        # measured against a stale grid.
        stale = {"grid_fingerprint": "deadbeef"}
        assert pg.report_missing_codes(True, GRID2, [stale], {}) == ["no_draw_stats"]


class _FakeRobot:
    """Enough Robot surface for do_draw(); no sockets, no hardware."""

    connected = True

    def __init__(self, pose=None):
        self.pose = list(pose or [5.0, 5.0, 0.0, 0.0, 0.0, 0.0])
        self.state = None
        self.replayed = 0
        self.moves = []

    def get_pose(self):
        return list(self.pose)

    def ensure_frame(self):
        pass

    def movl(self, *pose):
        self.moves.append(pose)

    def servo_stream(self, poses, **kwargs):
        self.replayed += 1

    def movl_path(self, poses, **kwargs):
        self.replayed += 1


class _FixedPoseRobot(_FakeRobot):
    """Same reading every time, so a run always sees the failure under test."""

    def __init__(self, reading):
        super().__init__()
        self.reading = list(reading)

    def get_pose(self):
        return list(self.reading)


class _RaiseOnceOnReplayRobot(_FakeRobot):
    """Plausible pose until the path is replayed, then raises once — the shape
    of a dashboard that drops off right after the last waypoint."""

    def __init__(self):
        super().__init__()
        self.failed = False

    def get_pose(self):
        if self.replayed and not self.failed:
            self.failed = True
            raise RuntimeError("socket closed after replay")
        return list(self.pose)


class _StopOnReplayRobot(_FakeRobot):
    """Raises Stop from inside the replay, the only way it can actually happen
    mid-run given do_draw() clears the flag on entry."""

    def servo_stream(self, poses, **kwargs):
        super().servo_stream(poses, **kwargs)
        self.state.draw_stop.set()

    def movl_path(self, poses, **kwargs):
        super().movl_path(poses, **kwargs)
        self.state.draw_stop.set()


def _run(robot, strokes=None):
    state = _FakeState()
    robot.state = state
    pg.do_draw(robot, state, strokes or [{"tool": "rect", "points": CLOSED_RECT}])
    return state, robot


class _FakeState:
    def __init__(self):
        import threading
        self.align_running = False
        self.draw_running = False
        self.draw_stop = threading.Event()
        self.status = ""
        self.grid_rows = 2
        self.grid_cols = 2
        self.grid_points = [list(r) for r in GRID2]
        self.test_points = []
        self.last_draw_stats = {}


class TestDrawEndCheck:
    """One free real measurement per draw: the arm is parked on the last
    waypoint before it is sent home, which is the only moment achievable
    without commanding extra motion."""

    def test_records_the_achieved_pose_at_the_final_waypoint(self):
        state, robot = _FakeState(), _FakeRobot([9.0, 5.0, 0.0, 0, 0, 0])
        pg.do_draw(robot, state, [{"tool": "rect", "points": CLOSED_RECT}])
        check = state.last_draw_stats["draw_end_check"]
        planned = pg.grid_pose(*CLOSED_RECT[-1], GRID2, 2, 2)[:3]
        assert check["planned_xyz"] == pytest.approx([round(c, 2) for c in planned])
        assert check["actual_xyz"] == [9.0, 5.0, 0.0]
        assert check["deviation_mm"] > 0

    def test_never_touches_test_points(self):
        # ServoP lags its target, so this is tracking error — sheet 05's
        # Max/RMSE must stay a pure deliberate 5-point test.
        state, robot = _FakeState(), _FakeRobot([9.0, 5.0, 0.0, 0, 0, 0])
        pg.do_draw(robot, state, [{"tool": "rect", "points": CLOSED_RECT}])
        assert state.test_points == []

    def test_uv_label_matches_the_compared_pose_even_with_a_trailing_empty_stroke(self):
        state, robot = _FakeState(), _FakeRobot([4.0, 5.0, 0.0, 0, 0, 0])
        pg.do_draw(robot, state, [{"tool": "rect", "points": CLOSED_RECT},
                                  {"tool": "rect", "points": []}])
        check = state.last_draw_stats["draw_end_check"]
        assert (check["u"], check["v"]) == pytest.approx(CLOSED_RECT[-1])

    def test_get_pose_failure_sentinel_records_nothing(self):
        state, _ = _run(_FixedPoseRobot([0.0] * 6))
        assert "draw_end_check" not in state.last_draw_stats

    def test_implausible_pose_records_nothing(self):
        state, _ = _run(_FixedPoseRobot([1e6, 1e6, 1e6, 0, 0, 0]))
        assert "draw_end_check" not in state.last_draw_stats

    def test_a_pose_read_that_raises_still_finishes_the_draw(self):
        state, robot = _run(_RaiseOnceOnReplayRobot())
        assert state.status.startswith("draw done")
        assert "draw_end_check" not in state.last_draw_stats
        assert state.draw_running is False

    def test_stop_pressed_during_replay_records_nothing(self):
        # do_draw() clears draw_stop on entry, so Stop has to arrive from the
        # replay itself — setting the flag beforehand proves nothing.
        state, _ = _run(_StopOnReplayRobot())
        assert "draw_end_check" not in state.last_draw_stats

    def test_draw_still_completes_normally_with_a_good_measurement(self):
        state, robot = _FakeState(), _FakeRobot([5.0, 5.0, 0.0, 0, 0, 0])
        pg.do_draw(robot, state, [{"tool": "rect", "points": CLOSED_RECT}])
        assert state.status.startswith("draw done")
        assert state.draw_running is False
        assert robot.replayed == 1
