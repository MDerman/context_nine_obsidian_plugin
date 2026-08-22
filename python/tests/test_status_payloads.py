from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest


CONFIGURED_VAULT_ROOT = os.environ.get("VAULT_ROOT")
pytestmark = pytest.mark.skipif(
    CONFIGURED_VAULT_ROOT is None,
    reason="VAULT_ROOT is required for cross-repository status contracts",
)
VAULT_ROOT = Path(CONFIGURED_VAULT_ROOT or "/missing-vault-root")


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_backup_status_payload_shape(monkeypatch):
    control_room = load_module(
        VAULT_ROOT / "_system/sync/scripts/control-room.py",
        "backup_control_room",
    )
    config = {
        "paths": {"logDir": "/tmp/rclone-logs"},
        "syncJobs": [{"name": "drive", "source": "/tmp", "destination": "remote:Drive", "schedule": {"kind": "daily", "hour": 2, "minute": 0}}],
        "externalJobs": [],
        "mounts": [],
    }
    monkeypatch.setattr(control_room, "process_table", lambda: [])
    monkeypatch.setattr(control_room, "mounted_paths", lambda: set())
    monkeypatch.setattr(control_room, "launchd_loaded", lambda _label: False)

    payload = control_room.backup_status_payload(config)

    assert payload["automation"]["supervisorLoaded"] is False
    assert payload["syncJobs"][0]["name"] == "drive"
    assert payload["syncJobs"][0]["progress"]["state"] == "no log"


def test_refresh_schedule_payload_shape(monkeypatch, tmp_path):
    refresh_schedule = load_module(
        VAULT_ROOT / "_system/commands/refresh_schedule.py",
        "refresh_schedule",
    )
    monkeypatch.setattr(refresh_schedule, "STATE_DIR", tmp_path)
    monkeypatch.setattr(refresh_schedule, "run_launchctl", lambda *args, **kwargs: type("Result", (), {"returncode": 1})())

    payload = refresh_schedule.status_payload(VAULT_ROOT)

    assert payload["label"]
    assert payload["loaded"] is False
    assert payload["time"]
