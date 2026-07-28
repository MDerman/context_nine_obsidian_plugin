import json
import os
from pathlib import Path

from context_nine_vault_tui.catalog import FALLBACK_COMMANDS, parse_catalog


def test_parse_v2_metadata():
    result = parse_catalog(
        """
        [
          {
            "id": "upgrade-apply",
            "label": "Upgrade",
            "description": "Apply upgrade",
            "args": ["upgrade", "--apply"],
            "group": "Upgrade",
            "risk": "apply",
            "mode": "long-running",
            "confirm": true,
            "statusArgs": ["upgrade", "status", "--json"],
            "tui": true,
            "promptArgs": [
              {"label": "Name", "argName": "name", "type": "choice", "choices": ["a", "b"]}
            ]
          }
        ]
        """
    )

    assert result.warning is None
    command = result.commands[0]
    assert command.id == "upgrade-apply"
    assert command.group == "Upgrade"
    assert command.risk == "apply"
    assert command.mode == "long-running"
    assert command.confirm is True
    assert command.status_args == ("upgrade", "status", "--json")
    assert command.prompt_args[0].choices == ("a", "b")


def test_invalid_metadata_falls_back():
    result = parse_catalog('{"not": "a list"}')

    assert result.commands == FALLBACK_COMMANDS
    assert result.warning


def test_vault_command_metadata_descriptions_are_short():
    vault_root = Path(
        os.environ.get(
            "VAULT_ROOT",
            "/Users/matthewderman/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault",
        )
    )
    path = vault_root / "_system/commands/vault-commands.json"
    commands = json.loads(path.read_text(encoding="utf-8"))

    for command in commands:
        description = command.get("description", "")
        assert description, command["id"]
        assert len(description) <= 100, f"{command['id']} description too long"
        assert description.count(".") <= 1, f"{command['id']} description should be one sentence"
