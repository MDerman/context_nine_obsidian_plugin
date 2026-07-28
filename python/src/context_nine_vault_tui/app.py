from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, VerticalScroll
from textual.message import Message
from textual.widgets import Button, Footer, Header, Input, Label, ListItem, ListView, RichLog, Static

from .catalog import CatalogLoadResult, VaultCommand, commands_by_group, load_catalog
from .pty_terminal import PtySession
from .runner import CommandRunner, Stream
from .state import VaultStateClient


class StateClient(Protocol):
    async def snapshot(self) -> dict[str, Any]:
        ...


@dataclass(frozen=True)
class CommandRequest:
    label: str
    args: tuple[str, ...]
    risk: str = "read"
    mode: str = "run"
    confirm: bool | str = False
    description: str = ""

    @property
    def needs_confirmation(self) -> bool:
        return bool(self.confirm) or self.risk in {"apply", "interactive", "destructive"}


class CommandCard(Static):
    can_focus = True

    class Selected(Message):
        def __init__(self, card: "CommandCard") -> None:
            super().__init__()
            self.card = card

    def on_click(self) -> None:
        self.post_message(self.Selected(self))


class VaultTuiApp(App[None]):
    CSS = """
    Screen {
      layout: vertical;
    }

    #body {
      height: 1fr;
    }

    #nav {
      width: 24;
      border-right: solid $accent;
    }

    #main {
      width: 1fr;
      padding: 1;
    }

    #content {
      height: auto;
    }

    #actions {
      height: 1fr;
      overflow-y: auto;
    }

    #confirm {
      dock: bottom;
      display: none;
      height: auto;
      padding: 1;
      border-top: solid $warning;
      background: $surface;
    }

    #confirm.visible {
      display: block;
    }

    .panel-title {
      text-style: bold;
      color: $accent;
    }

    .muted {
      color: $text-muted;
    }

    .danger {
      color: $error;
    }

    Button {
      margin: 0 1 1 0;
    }

    .command-row {
      height: 4;
      margin: 0 0 1 0;
    }

    .command-card {
      width: 1fr;
      height: 4;
      margin: 0 1 0 0;
      padding: 0 1;
      border: solid $panel;
      background: $surface;
    }

    .command-card:hover {
      border: solid $accent;
    }

    .command-card:focus {
      border: solid $accent;
    }

    #log {
      display: none;
      height: 14;
      border: solid $panel;
    }

    #log.visible {
      display: block;
    }
    """

    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "refresh", "Refresh"),
        ("l", "clear_log", "Clear Log"),
        ("c", "cancel_command", "Cancel"),
    ]

    def __init__(
        self,
        vault_root: Path,
        vault_command: str = "vault",
        state_client: StateClient | None = None,
        catalog_result: CatalogLoadResult | None = None,
        command_columns: int = 5,
    ) -> None:
        super().__init__()
        self.vault_root = vault_root
        self.vault_command = vault_command
        self.state_client = state_client or VaultStateClient(vault_root, vault_command)
        self.catalog_result = catalog_result
        self.runner = CommandRunner(vault_root, vault_command)
        self.snapshot: dict[str, Any] = {}
        self.current_view = "dashboard"
        self.button_commands: dict[str, CommandRequest] = {}
        self.pending_command: CommandRequest | None = None
        self.pty_session: PtySession | None = None
        self.log_has_output = False
        self.command_columns = max(1, min(6, command_columns))

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal(id="body"):
            yield ListView(
                ListItem(Label("Dashboard"), id="nav-dashboard"),
                ListItem(Label("Backup Sync"), id="nav-backup"),
                ListItem(Label("Upgrade"), id="nav-upgrade"),
                ListItem(Label("Commands"), id="nav-commands"),
                ListItem(Label("Terminal"), id="nav-terminal"),
                id="nav",
            )
            with Vertical(id="main"):
                yield Static(id="content")
                yield Container(id="actions")
                yield RichLog(id="log", highlight=True, markup=True)
                with Container(id="confirm"):
                    yield Static(id="confirm-text")
                    yield Input(placeholder="Type command label for strong confirmation", id="confirm-input")
                    yield Button("Confirm", variant="warning", id="confirm-run")
                    yield Button("Cancel", id="confirm-cancel")
        yield Footer()

    async def on_mount(self) -> None:
        self.title = "Vault TUI Control Room"
        if self.catalog_result is None:
            self.catalog_result = load_catalog(self.vault_root)
        await self.refresh_status()
        await self.render_view()

    async def action_refresh(self) -> None:
        await self.refresh_status()
        await self.render_view()

    async def action_clear_log(self) -> None:
        self.query_one("#log", RichLog).clear()
        self.log_has_output = False
        self.render_log_visibility()

    async def action_cancel_command(self) -> None:
        await self.runner.cancel()
        if self.pty_session:
            self.pty_session.terminate()
        await self.write_log("system", "cancel requested\n")

    async def on_list_view_selected(self, event: ListView.Selected) -> None:
        item_id = event.item.id or ""
        self.current_view = item_id.replace("nav-", "")
        await self.render_view()

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        button_id = event.button.id or ""
        if button_id == "confirm-run":
            await self.confirm_pending()
            return
        if button_id == "confirm-cancel":
            self.pending_command = None
            self.render_confirm()
            return
        request = self.button_commands.get(button_id)
        if not request:
            return
        await self.request_command(request)

    async def on_command_card_selected(self, event: CommandCard.Selected) -> None:
        request = self.button_commands.get(event.card.id or "")
        if request:
            await self.request_command(request)

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id == "terminal-input" and self.pty_session:
            self.pty_session.write(event.value + "\n")
            event.input.value = ""
        elif event.input.id == "confirm-input":
            await self.confirm_pending()

    async def refresh_status(self) -> None:
        try:
            self.snapshot = await self.state_client.snapshot()
        except Exception as exc:
            self.snapshot = {"vaultRoot": str(self.vault_root), "error": str(exc)}
            await self.write_log("stderr", f"status refresh failed: {exc}\n")

    async def render_view(self) -> None:
        self.button_commands.clear()
        content = self.query_one("#content", Static)
        actions = self.query_one("#actions", Container)
        await actions.remove_children()
        if self.current_view == "backup":
            content.update(self.backup_markup())
            await self.render_backup_buttons(actions)
        elif self.current_view == "upgrade":
            content.update(self.upgrade_markup())
            await self.render_upgrade_buttons(actions)
        elif self.current_view == "commands":
            content.update(self.commands_markup())
            await self.render_command_buttons(actions)
        elif self.current_view == "terminal":
            content.update(self.terminal_markup())
            await self.render_terminal_controls(actions)
        else:
            content.update(self.dashboard_markup())
        self.render_confirm()

    def dashboard_markup(self) -> str:
        refresh = self.snapshot.get("refreshSchedule", {})
        git = self.snapshot.get("git", {})
        upgrade = self.snapshot.get("upgrade", {})
        dirty = "dirty" if git.get("dirty") else "clean"
        lines = [
            "[b]Vault TUI Control Room[/b]",
            "",
            f"vault: {self.snapshot.get('vaultRoot', self.vault_root)}",
            f"git: {dirty}",
            f"refresh: {refresh.get('loaded', 'unknown')} at {refresh.get('time', 'unknown')}",
            f"last refresh: {refresh.get('lastRefreshDate') or 'none'}",
            f"upgrade: {upgrade.get('state', 'unknown')}",
        ]
        if self.catalog_result and self.catalog_result.warning:
            lines.append(f"[yellow]metadata: {self.catalog_result.warning}[/yellow]")
        if self.snapshot.get("error"):
            lines.append(f"[red]status: {self.snapshot['error']}[/red]")
        return "\n".join(lines)

    def backup_markup(self) -> str:
        backup = self.snapshot.get("backup", {})
        automation = backup.get("automation", {})
        lines = [
            "[b]Backup Sync[/b]",
            f"supervisor: {status_word(automation.get('supervisorLoaded'))}",
            f"syncs paused: {automation.get('syncsPaused', 'unknown')}",
            f"mounts paused: {automation.get('mountsPaused', 'unknown')}",
            "",
        ]
        for key, label in (("syncJobs", "Sync Jobs"), ("externalJobs", "External Jobs"), ("mounts", "Mounts")):
            lines.append(f"[b]{label}[/b]")
            for item in backup.get(key, []):
                progress = item.get("progress", {})
                summary = progress_summary(progress)
                lines.append(f"- {item.get('name')}: {item.get('status')} {summary}")
                step = item.get("nextStep")
                if step:
                    lines.append(f"  next: {step}")
            lines.append("")
        return "\n".join(lines)

    def upgrade_markup(self) -> str:
        upgrade = self.snapshot.get("upgrade", {})
        deps = self.snapshot.get("deps", {})
        doctor = self.snapshot.get("upgradeDoctor", {})
        repo_count = len(deps.get("repos", []))
        dirty_deps = [repo.get("id") for repo in deps.get("repos", []) if repo.get("dirty")]
        return "\n".join(
            [
                "[b]Upgrade[/b]",
                f"state: {upgrade.get('state', 'unknown')}",
                f"installed: {upgrade.get('installedVersion') or 'unknown'}",
                f"latest: {upgrade.get('latestVersion') or 'unknown'}",
                f"up to date: {upgrade.get('upToDate')}",
                f"doctor ok: {doctor.get('ok', 'unknown')}",
                f"deps: {repo_count} repos",
                f"dirty deps: {', '.join(dirty_deps) if dirty_deps else 'none'}",
                f"latest report: {upgrade.get('latestReport') or 'none'}",
            ]
        )

    def commands_markup(self) -> str:
        count = len(self.catalog_result.commands if self.catalog_result else [])
        return f"[b]Commands[/b]\n{count} commands loaded from shared metadata. Columns: {self.command_columns}."

    def terminal_markup(self) -> str:
        return "[b]Interactive Terminal[/b]\nUse setup/shared-drive buttons, then type into input below."

    async def render_backup_buttons(self, container: Container) -> None:
        await self.add_button(container, "Refresh Status", CommandRequest("Backup Sync Status", ("backup-sync", "status"), "read"))
        await self.add_button(container, "Pause", CommandRequest("Backup Sync Pause", ("backup-sync", "pause"), "apply", confirm=True))
        await self.add_button(container, "Resume", CommandRequest("Backup Sync Resume", ("backup-sync", "resume"), "apply", confirm=True))
        backup = self.snapshot.get("backup", {})
        for item in backup.get("syncJobs", []):
            name = str(item.get("name"))
            await self.add_button(container, f"Dry Run {name}", CommandRequest(f"Dry Run {name}", ("backup-sync", "start", "sync", name, "--dry-run"), "dry-run"))
            await self.add_button(container, f"Start {name}", CommandRequest(f"Start {name}", ("backup-sync", "start", "sync", name), "apply", confirm=True))
            await self.add_button(container, f"Stop {name}", CommandRequest(f"Stop {name}", ("backup-sync", "stop", "sync", name), "apply", confirm=True))
        for item in backup.get("externalJobs", []):
            name = str(item.get("name"))
            await self.add_button(container, f"Dry Run {name}", CommandRequest(f"Dry Run {name}", ("backup-sync", "start", "external", name, "--dry-run"), "dry-run"))
            await self.add_button(container, f"Start {name}", CommandRequest(f"Start {name}", ("backup-sync", "start", "external", name), "apply", confirm=True))
            await self.add_button(container, f"Stop {name}", CommandRequest(f"Stop {name}", ("backup-sync", "stop", "external", name), "apply", confirm=True))
        for item in backup.get("mounts", []):
            name = str(item.get("name"))
            await self.add_button(container, f"Mount {name}", CommandRequest(f"Mount {name}", ("backup-sync", "start", "mount", name), "apply", confirm=True))
            await self.add_button(container, f"Unmount {name}", CommandRequest(f"Unmount {name}", ("backup-sync", "stop", "mount", name), "apply", confirm=True))
            await self.add_button(container, f"Restart {name}", CommandRequest(f"Restart {name}", ("backup-sync", "restart", "mount", name), "apply", confirm=True))

    async def render_upgrade_buttons(self, container: Container) -> None:
        for request in [
            CommandRequest("Upgrade Status", ("upgrade", "status"), risk="read"),
            CommandRequest("Upgrade Doctor", ("upgrade", "doctor"), risk="read"),
            CommandRequest("Upgrade Dry Run", ("upgrade", "--dry-run"), risk="dry-run", mode="long-running"),
            CommandRequest("Upgrade Apply", ("upgrade", "--apply"), risk="apply", mode="long-running", confirm=True),
            CommandRequest("Repair Prompt", ("upgrade", "repair-prompt"), risk="read"),
            CommandRequest("Deps Status", ("deps", "status"), risk="read"),
            CommandRequest("Deps Dry Run", ("deps", "sync", "--dry-run"), risk="dry-run", mode="long-running"),
            CommandRequest("Deps Sync", ("deps", "sync", "--apply"), risk="apply", mode="long-running", confirm=True),
        ]:
            await self.add_button(container, request.label, request)

    async def render_command_buttons(self, container: Container) -> None:
        if not self.catalog_result:
            return
        scroll = VerticalScroll(classes="button-row")
        await container.mount(scroll)
        for group, commands in commands_by_group(self.catalog_result.commands).items():
            await scroll.mount(Label(group, classes="panel-title"))
            for row_commands in chunks(commands, self.command_columns):
                row = Horizontal(classes="command-row")
                await scroll.mount(row)
                for command in row_commands:
                    request = CommandRequest(
                        command.label,
                        command.args,
                        risk=command.risk,
                        mode=command.mode,
                        confirm=command.confirm,
                        description=command.description,
                    )
                    await self.add_command_card(row, request)

    async def render_terminal_controls(self, container: Container) -> None:
        await self.add_button(container, "Setup Wizard", CommandRequest("Backup Sync Setup", ("backup-sync", "setup"), "interactive", "interactive", True))
        await self.add_button(container, "Shared Drives", CommandRequest("Backup Shared Drives", ("backup-sync", "shared-drives"), "interactive", "interactive", True))
        await container.mount(Input(placeholder="type input for interactive command", id="terminal-input"))

    async def add_button(self, container: Container | VerticalScroll, label: str, request: CommandRequest) -> None:
        button_id = f"cmd-{slug(label)}"
        suffix = 2
        while button_id in self.button_commands:
            button_id = f"cmd-{slug(label)}-{suffix}"
            suffix += 1
        self.button_commands[button_id] = request
        await container.mount(Button(label, id=button_id, variant=variant_for_risk(request.risk)))

    async def add_command_card(self, container: Container | Horizontal, request: CommandRequest) -> None:
        card_id = f"cmd-{slug(request.label)}"
        suffix = 2
        while card_id in self.button_commands:
            card_id = f"cmd-{slug(request.label)}-{suffix}"
            suffix += 1
        self.button_commands[card_id] = request
        await container.mount(
            CommandCard(
                command_card_markup(request.label, request.description),
                id=card_id,
                classes=f"command-card is-{request.risk}",
            )
        )

    async def request_command(self, request: CommandRequest) -> None:
        if request.needs_confirmation:
            self.pending_command = request
            self.render_confirm()
            return
        await self.run_request(request)

    async def confirm_pending(self) -> None:
        if not self.pending_command:
            return
        request = self.pending_command
        if request.confirm == "strong":
            typed = self.query_one("#confirm-input", Input).value.strip()
            if typed != request.label:
                await self.write_log("stderr", f"type exact label to confirm: {request.label}\n")
                return
        self.pending_command = None
        self.render_confirm()
        await self.run_request(request)

    def render_confirm(self) -> None:
        panel = self.query_one("#confirm", Container)
        text = self.query_one("#confirm-text", Static)
        input_box = self.query_one("#confirm-input", Input)
        if not self.pending_command:
            panel.remove_class("visible")
            input_box.display = False
            input_box.value = ""
            text.update("")
            return
        panel.add_class("visible")
        request = self.pending_command
        text.update(f"Confirm {request.label}: vault {' '.join(request.args)}")
        input_box.display = request.confirm == "strong"

    async def run_request(self, request: CommandRequest) -> None:
        if request.mode == "interactive":
            await self.run_interactive(request)
            return
        if self.runner.running:
            await self.write_log("stderr", "command already running\n")
            return
        asyncio.create_task(self._run_command(request))

    async def _run_command(self, request: CommandRequest) -> None:
        await self.runner.run(request.args, self.write_log)
        await self.refresh_status()
        await self.render_view()

    async def run_interactive(self, request: CommandRequest) -> None:
        if self.pty_session and self.pty_session.running:
            await self.write_log("stderr", "interactive command already running\n")
            return
        command = self.runner.resolved_command()
        self.current_view = "terminal"
        await self.render_view()
        self.pty_session = PtySession(self.vault_root, command, request.args)
        asyncio.create_task(self._run_pty(request))

    async def _run_pty(self, request: CommandRequest) -> None:
        if not self.pty_session:
            return
        code = await self.pty_session.start(lambda text: self.write_log("stdout", text))
        await self.write_log("stdout", f"\ninteractive exit: {code}\n")
        await self.refresh_status()
        await self.render_view()

    async def write_log(self, stream: Stream | str, text: str) -> None:
        log = self.query_one("#log", RichLog)
        self.log_has_output = True
        self.render_log_visibility()
        prefix = {"stderr": "[red]", "system": "[yellow]"}.get(stream, "")
        suffix = "[/red]" if stream == "stderr" else ("[/yellow]" if stream == "system" else "")
        for line in text.splitlines() or [""]:
            log.write(f"{prefix}{line}{suffix}")

    def render_log_visibility(self) -> None:
        self.query_one("#log", RichLog).set_class(self.log_has_output, "visible")


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip().lower()).strip("-")
    return cleaned or "command"


def status_word(value: Any) -> str:
    if value is True:
        return "loaded"
    if value is False:
        return "not loaded"
    return "unknown"


def progress_summary(progress: dict[str, Any]) -> str:
    if progress.get("state") != "stats":
        return str(progress.get("state") or "")
    parts = [str(progress.get(key)) for key in ("transferred", "percent", "speed") if progress.get(key)]
    if progress.get("eta"):
        parts.append(f"ETA {progress['eta']}")
    return f"({', '.join(parts)})" if parts else ""


def command_card_markup(label: str, description: str) -> str:
    clean = compact_description(description)
    return f"[b]{label}[/b]\n[dim]{clean}[/dim]" if clean else f"[b]{label}[/b]"


def compact_description(description: str, limit: int = 92) -> str:
    text = " ".join(description.strip().split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def chunks(items: list[VaultCommand], size: int) -> list[list[VaultCommand]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def variant_for_risk(risk: str) -> str:
    if risk == "destructive":
        return "error"
    if risk in {"apply", "interactive"}:
        return "warning"
    if risk == "dry-run":
        return "primary"
    return "default"
