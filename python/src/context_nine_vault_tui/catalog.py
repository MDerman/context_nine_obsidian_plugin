from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal


Risk = Literal["read", "dry-run", "apply", "interactive", "destructive"]
Mode = Literal["run", "interactive", "long-running"]
Confirm = bool | Literal["strong"]


METADATA_PATH = Path("_system/commands/vault-commands.json")


@dataclass(frozen=True)
class PromptArg:
    label: str
    placeholder: str = ""
    arg_name: str = ""
    type: Literal["text", "choice"] = "text"
    choices: tuple[str, ...] = ()


@dataclass(frozen=True)
class VaultCommand:
    id: str
    label: str
    description: str
    args: tuple[str, ...]
    aliases: tuple[str, ...] = ()
    cockpit: bool = False
    palette: bool = False
    group: str = "Commands"
    risk: Risk = "read"
    tui: bool = False
    mode: Mode = "run"
    confirm: Confirm = False
    status_args: tuple[str, ...] = ()
    prompt_args: tuple[PromptArg, ...] = ()

    @property
    def needs_confirmation(self) -> bool:
        return bool(self.confirm) or self.risk in {"apply", "interactive", "destructive"}


@dataclass(frozen=True)
class CatalogLoadResult:
    commands: tuple[VaultCommand, ...]
    warning: str | None = None


FALLBACK_COMMANDS = (
    VaultCommand(
        id="refresh",
        label="Refresh",
        description="Refresh integrations, schedules, periodic rollups, and Dashboard.",
        args=("refresh",),
        cockpit=True,
        palette=True,
        group="Daily Ops",
        risk="apply",
        mode="long-running",
        confirm=True,
        tui=True,
    ),
    VaultCommand(
        id="backup-sync-status",
        label="Backup Sync Status",
        description="Show backup/sync state.",
        args=("backup-sync", "status"),
        status_args=("backup-sync", "status", "--json"),
        group="Backup Sync",
        tui=True,
    ),
    VaultCommand(
        id="upgrade-status",
        label="Upgrade Status",
        description="Show upgrade state.",
        args=("upgrade", "status"),
        status_args=("upgrade", "status", "--json"),
        group="Upgrade",
        tui=True,
    ),
)


def load_catalog(vault_root: Path) -> CatalogLoadResult:
    path = vault_root / METADATA_PATH
    try:
        return parse_catalog(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return CatalogLoadResult(FALLBACK_COMMANDS, f"Could not read {path}: {exc}")


def parse_catalog(raw: str) -> CatalogLoadResult:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        return CatalogLoadResult(FALLBACK_COMMANDS, f"Could not parse command metadata: {exc}")
    if not isinstance(parsed, list):
        return CatalogLoadResult(FALLBACK_COMMANDS, "Command metadata must be a JSON array.")

    commands: list[VaultCommand] = []
    for index, item in enumerate(parsed):
        command = parse_command(item)
        if command is None:
            return CatalogLoadResult(FALLBACK_COMMANDS, f"Invalid command metadata at index {index}.")
        commands.append(command)
    if not commands:
        return CatalogLoadResult(FALLBACK_COMMANDS, "Command metadata is empty.")
    return CatalogLoadResult(tuple(commands))


def parse_command(item: Any) -> VaultCommand | None:
    if not isinstance(item, dict):
        return None
    required = ("id", "label", "description", "args")
    if any(not isinstance(item.get(key), str) for key in required[:-1]):
        return None
    args = item.get("args")
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        return None

    aliases = item.get("aliases", [])
    status_args = item.get("statusArgs", [])
    prompt_args = item.get("promptArgs", [])
    if not is_string_list(aliases) or not is_string_list(status_args):
        return None
    if not isinstance(prompt_args, list):
        return None
    prompts = []
    for prompt in prompt_args:
        parsed_prompt = parse_prompt_arg(prompt)
        if parsed_prompt is None:
            return None
        prompts.append(parsed_prompt)

    risk = item.get("risk", "read")
    mode = item.get("mode", "run")
    confirm = item.get("confirm", False)
    if risk not in {"read", "dry-run", "apply", "interactive", "destructive"}:
        return None
    if mode not in {"run", "interactive", "long-running"}:
        return None
    if not (isinstance(confirm, bool) or confirm == "strong"):
        return None

    return VaultCommand(
        id=item["id"],
        label=item["label"],
        description=item["description"],
        args=tuple(args),
        aliases=tuple(aliases),
        cockpit=bool(item.get("cockpit", False)),
        palette=bool(item.get("palette", False)),
        group=str(item.get("group") or "Commands"),
        risk=risk,
        tui=bool(item.get("tui", False)),
        mode=mode,
        confirm=confirm,
        status_args=tuple(status_args),
        prompt_args=tuple(prompts),
    )


def parse_prompt_arg(item: Any) -> PromptArg | None:
    if not isinstance(item, dict) or not isinstance(item.get("label"), str):
        return None
    prompt_type = item.get("type", "text")
    choices = item.get("choices", [])
    if prompt_type not in {"text", "choice"} or not is_string_list(choices):
        return None
    return PromptArg(
        label=item["label"],
        placeholder=str(item.get("placeholder") or ""),
        arg_name=str(item.get("argName") or ""),
        type=prompt_type,
        choices=tuple(choices),
    )


def commands_by_group(commands: tuple[VaultCommand, ...]) -> dict[str, list[VaultCommand]]:
    grouped: dict[str, list[VaultCommand]] = {}
    for command in commands:
        if command.tui:
            grouped.setdefault(command.group, []).append(command)
    return grouped


def is_string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)
