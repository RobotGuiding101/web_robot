"""Unit tests for maps_point.config — env parsing + defaults.

config.py reads everything from os.environ at import time (with a .env file
override), so these tests reload the module under a controlled environment.
"""
import importlib

import pytest

import maps_point.config as config

_TRACKED = (
    "ROBOT_IP", "Z_CALIB_SPEED", "DEPTH_CAM_SERIAL", "DEPTH_N_FRAMES",
    "DRAW_MOTION_MODE", "DRAW_MAX_POINTS", "DRAW_SIMPLIFY_EPS",
    "DRAW_GRID_MAX_ROWS", "DRAW_GRID_MAX_COLS", "Z_SURFACE",
    "HOME_X", "HOME_Y", "HOME_Z", "CAM_X_SIGN", "CAM_Y_SIGN",
)


@pytest.fixture
def reload_config(monkeypatch):
    """Reload maps_point.config with a stubbed load_dotenv.

    Stubbing load_dotenv keeps a developer's real backend/.maps_point.env from
    leaking into assertions (config.py calls it with override=True)."""
    import dotenv
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: None)
    for key in _TRACKED:
        monkeypatch.delenv(key, raising=False)
    return lambda: importlib.reload(config)


def test_defaults_when_env_empty(reload_config):
    c = reload_config()
    assert c.ROBOT_IP == "192.168.10.110"
    assert c.MOVE_SPEED == 10
    assert c.DEPTH_N_FRAMES == 30
    assert c.CAM_X_SIGN == 1
    assert c.CAM_Y_SIGN == 1
    assert c.DRAW_MAX_POINTS == 60
    assert c.DRAW_SIMPLIFY_EPS == 0.015
    assert c.DRAW_GRID_MAX_ROWS == 7
    assert c.DRAW_GRID_MAX_COLS == 7
    assert c.Z_SURFACE is None
    assert c.HOME_X == 0.0


def test_env_overrides_and_type_coercion(reload_config, monkeypatch):
    monkeypatch.setenv("ROBOT_IP", "10.0.0.5")
    monkeypatch.setenv("Z_CALIB_SPEED", "42")
    monkeypatch.setenv("DEPTH_N_FRAMES", "7")
    monkeypatch.setenv("CAM_X_SIGN", "-1")
    monkeypatch.setenv("DRAW_MAX_POINTS", "12")
    c = reload_config()
    assert c.ROBOT_IP == "10.0.0.5"
    assert c.MOVE_SPEED == 42 and isinstance(c.MOVE_SPEED, int)
    assert c.DEPTH_N_FRAMES == 7
    assert c.CAM_X_SIGN == -1
    assert c.DRAW_MAX_POINTS == 12


def test_motion_mode_is_lowercased_and_stripped(reload_config, monkeypatch):
    monkeypatch.setenv("DRAW_MOTION_MODE", "  CP  ")
    c = reload_config()
    assert c.DRAW_MOTION_MODE == "cp"


def test_z_surface_optional_parsing(reload_config, monkeypatch):
    monkeypatch.setenv("Z_SURFACE", "12.5")
    assert reload_config().Z_SURFACE == 12.5
    monkeypatch.delenv("Z_SURFACE")
    assert reload_config().Z_SURFACE is None
    monkeypatch.setenv("Z_SURFACE", "   ")
    assert reload_config().Z_SURFACE is None


def test_robot_mode_labels_mapping(reload_config):
    c = reload_config()
    assert c.ROBOT_MODE_LABELS[5] == "ENABLE"
    assert c.ROBOT_MODE_LABELS[9] == "ERROR"
    assert c.ROBOT_MODE_LABELS[7] == "RUNNING"
