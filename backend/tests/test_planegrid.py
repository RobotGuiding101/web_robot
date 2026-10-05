"""Unit tests for maps_point.planegrid — pure geometry / interpolation math.

These functions are the safest, highest-value things to unit test: no camera,
no robot, no sockets — just arithmetic on taught poses.
"""
import math
import threading
from types import SimpleNamespace

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


class TestDrawApproach:
    @staticmethod
    def _state():
        return SimpleNamespace(
            align_running=False,
            draw_running=False,
            draw_stop=threading.Event(),
            grid_rows=2,
            grid_cols=2,
            grid_points=GRID2,
            status="",
        )

    def test_approaches_and_descends_before_replaying_path(self, monkeypatch):
        start_pose = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        first_pose = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0]
        poses = [first_pose, [11.0, 21.0, 30.0, 40.0, 50.0, 60.0]]
        events = []

        class FakeRobot:
            connected = True

            def ensure_frame(self):
                pass

            def get_pose(self):
                return start_pose

            def movl(self, *pose):
                events.append(("movl", list(pose)))

            def movl_path(self, path, **kwargs):
                events.append(("path", path))

        monkeypatch.setattr(pg, "DRAW_MOTION_MODE", "cp")
        monkeypatch.setattr(pg, "DRAW_LIFT_MM", 15.0)
        monkeypatch.setattr(pg, "_assemble_strokes", lambda *args: poses)

        pg.do_draw(FakeRobot(), self._state(), [{"tool": "pen", "points": [(0, 0)]}])

        assert events[:4] == [
            ("movl", [1.0, 2.0, 18.0, 4.0, 5.0, 6.0]),
            ("movl", [10.0, 20.0, 45.0, 40.0, 50.0, 60.0]),
            ("movl", first_pose),
            ("path", poses),
        ]

    def test_stop_during_approach_prevents_next_move_and_draw(self, monkeypatch):
        state = self._state()
        events = []

        class FakeRobot:
            connected = True

            def ensure_frame(self):
                pass

            def get_pose(self):
                return [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]

            def movl(self, *pose):
                events.append(("movl", pose))
                state.draw_stop.set()

            def movl_path(self, path, **kwargs):
                events.append(("path", path))

        monkeypatch.setattr(pg, "DRAW_LIFT_MM", 15.0)
        monkeypatch.setattr(pg, "_assemble_strokes", lambda *args: [[10, 20, 30, 40, 50, 60]])

        pg.do_draw(FakeRobot(), state, [{"tool": "pen", "points": [(0, 0)]}])

        assert len(events) == 1
        assert events[0][0] == "movl"
        assert "aborted" in state.status