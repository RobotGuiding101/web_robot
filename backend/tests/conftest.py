"""Shared pytest setup for backend unit tests."""
import os
import sys
import types
from pathlib import Path

import pytest

# routers/auth.py refuses to import without a strong JWT_SECRET; tests don't
# exercise real auth, so give them a throwaway value.
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production-0123456789")

# Make `import database`, `import models`, `from maps_point import ...` work
# regardless of the directory pytest is invoked from.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# pyrealsense2 is a hardware-only SDK (and has no wheel on x86 CI). Stub it so
# modules that import it at module scope can still be imported by unit tests.
if "pyrealsense2" not in sys.modules:
    try:  # pragma: no cover - only exercised when the SDK really is installed
        import pyrealsense2  # noqa: F401
    except Exception:
        sys.modules["pyrealsense2"] = types.ModuleType("pyrealsense2")


@pytest.fixture(autouse=True)
def _clear_auth_cache():
    """The auth module memoises users for 60s; keep tests order-independent."""
    try:
        from routers import auth
        auth._USER_CACHE.clear()
        yield
        auth._USER_CACHE.clear()
    except Exception:  # pragma: no cover
        yield
