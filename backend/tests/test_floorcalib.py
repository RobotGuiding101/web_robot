"""Unit tests for maps_point.floorcalib — floor-plane homography math."""
import numpy as np
import pytest

from maps_point import floorcalib as fc

# choose pixels spread over the frame, project through a known H to make pairs
PIXELS = [(100, 80), (540, 90), (110, 400), (520, 410), (320, 250), (200, 150)]
TRUE_H = np.array([[1.8, 0.12, -380.0],
                   [0.07, 1.75, -540.0],
                   [0.0004, -0.0003, 1.0]])


def _world(h, u, v):
    return fc.apply_homography(h, u, v)


def _pairs_from(h):
    return [((u, v), _world(h, u, v)) for (u, v) in PIXELS]


def test_recovers_known_homography():
    pairs = _pairs_from(TRUE_H)
    h = fc.compute_homography(pairs)
    assert h is not None
    for (u, v), (X, Y) in pairs:
        rx, ry = fc.apply_homography(h, u, v)
        assert rx == pytest.approx(X, abs=1e-6)
        assert ry == pytest.approx(Y, abs=1e-6)
    assert fc.reprojection_rmse(h, pairs) == pytest.approx(0.0, abs=1e-6)


def test_needs_at_least_four_points():
    assert fc.compute_homography(_pairs_from(TRUE_H)[:3]) is None


def test_degenerate_collinear_points_rejected():
    pairs = [((u, 200.0), (float(u), 0.0)) for u in (100, 200, 300, 400)]
    assert fc.compute_homography(pairs) is None


def test_apply_homography_matches_manual_projection():
    x, y = fc.apply_homography(TRUE_H, 300, 260)
    p = TRUE_H @ np.array([300, 260, 1.0])
    assert x == pytest.approx(p[0] / p[2])
    assert y == pytest.approx(p[1] / p[2])


def test_invert_round_trip():
    inv = fc.invert(TRUE_H)
    X, Y = _world(TRUE_H, 275, 190)
    u, v = fc.apply_homography(inv, X, Y)
    assert u == pytest.approx(275, abs=1e-6)
    assert v == pytest.approx(190, abs=1e-6)


def test_rmse_reflects_noise():
    pairs = _pairs_from(TRUE_H)
    noisy = [((u, v), (X + 3.0, Y - 2.0)) for (u, v), (X, Y) in pairs]
    h = fc.compute_homography(noisy)
    assert fc.reprojection_rmse(h, noisy) < 3.0


def test_save_load_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(fc, "CALIB_PATH", tmp_path / "floor_calib.json")
    pairs = _pairs_from(TRUE_H)
    h = fc.compute_homography(pairs)
    fc.save(pairs, h, floor_z=12.5)

    pairs2, h2, z2 = fc.load()
    assert len(pairs2) == len(pairs)
    assert z2 == pytest.approx(12.5)
    assert h2 is not None
    for (u, v), (X, Y) in pairs2:
        rx, ry = fc.apply_homography(h2, u, v)
        assert rx == pytest.approx(X, abs=1e-6)
        assert ry == pytest.approx(Y, abs=1e-6)


def test_load_without_file_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(fc, "CALIB_PATH", tmp_path / "missing.json")
    assert fc.load() == ([], None, None)
