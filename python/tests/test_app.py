from __future__ import annotations

import pytest

from context_nine_vault_tui.app import VaultTuiApp, compact_description
from context_nine_vault_tui.catalog import CatalogLoadResult, VaultCommand


class FakeStateClient:
    async def snapshot(self):
        return {
            "vaultRoot": "/tmp/vault",
            "refreshSchedule": {"loaded": True, "time": "02:00", "lastRefreshDate": "2026-07-08"},
            "git": {"dirty": False, "changes": []},
            "upgrade": {"state": "ok", "installedVersion": "1", "latestVersion": "1", "upToDate": True},
            "upgradeDoctor": {"ok": True},
            "deps": {"repos": []},
            "backup": {
                "automation": {"supervisorLoaded": True, "syncsPaused": False, "mountsPaused": False},
                "syncJobs": [{"name": "drive", "status": "stopped", "progress": {"state": "no log"}}],
                "externalJobs": [],
                "mounts": [],
            },
        }


@pytest.mark.asyncio
async def test_app_boots_with_fake_state(tmp_path):
    app = VaultTuiApp(tmp_path, state_client=FakeStateClient(), catalog_result=CatalogLoadResult(tuple()))

    async with app.run_test() as pilot:
        await pilot.pause()
        assert "Vault TUI Control Room" in str(app.query_one("#content").render())
        assert not app.query_one("#log").has_class("visible")


@pytest.mark.asyncio
async def test_log_panel_only_shows_when_output_exists(tmp_path):
    app = VaultTuiApp(tmp_path, state_client=FakeStateClient(), catalog_result=CatalogLoadResult(tuple()))

    async with app.run_test() as pilot:
        await pilot.pause()
        await app.write_log("stdout", "hello\n")
        assert app.query_one("#log").has_class("visible")
        await app.action_clear_log()
        assert not app.query_one("#log").has_class("visible")


@pytest.mark.asyncio
async def test_risky_command_requires_confirmation(tmp_path):
    catalog = CatalogLoadResult(
        (
            VaultCommand(
                id="upgrade-apply",
                label="Upgrade",
                description="Apply upgrade",
                args=("upgrade", "--apply"),
                group="Upgrade",
                risk="apply",
                confirm=True,
                tui=True,
            ),
        )
    )
    app = VaultTuiApp(tmp_path, state_client=FakeStateClient(), catalog_result=catalog)

    async with app.run_test() as pilot:
        await pilot.click("ListItem#nav-commands")
        await pilot.pause()
        await pilot.click("CommandCard#cmd-upgrade")
        await pilot.pause()
        assert app.pending_command is not None
        assert app.pending_command.label == "Upgrade"


@pytest.mark.asyncio
async def test_commands_render_in_configurable_grid(tmp_path):
    catalog = CatalogLoadResult(
        (
            VaultCommand(
                id="one",
                label="One",
                description="First command.",
                args=("one",),
                group="Ops",
                tui=True,
            ),
            VaultCommand(
                id="two",
                label="Two",
                description="Second command.",
                args=("two",),
                group="Ops",
                tui=True,
            ),
            VaultCommand(
                id="three",
                label="Three",
                description="Third command.",
                args=("three",),
                group="Ops",
                tui=True,
            ),
        )
    )
    app = VaultTuiApp(
        tmp_path,
        state_client=FakeStateClient(),
        catalog_result=catalog,
        command_columns=2,
    )

    async with app.run_test() as pilot:
        await pilot.click("ListItem#nav-commands")
        await pilot.pause()
        assert len(app.query(".command-row")) == 2
        assert len(app.query("CommandCard")) == 3
        assert "First command." in str(app.query_one("CommandCard#cmd-one").render())


def test_compact_description_keeps_cards_readable():
    text = compact_description("x" * 120, limit=20)

    assert text == "x" * 19 + "…"
