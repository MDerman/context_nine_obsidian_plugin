from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any


class VaultStateClient:
    def __init__(self, vault_root: Path, vault_command: str = "vault") -> None:
        self.vault_root = vault_root
        self.vault_command = vault_command

    async def snapshot(self) -> dict[str, Any]:
        backup, upgrade, doctor, deps, refresh, git_status = await asyncio.gather(
            self.run_json(("backup-sync", "status", "--json")),
            self.run_json(("upgrade", "status", "--json")),
            self.run_json(("upgrade", "doctor", "--json"), allow_failure=True),
            self.run_json(("deps", "status", "--json")),
            self.run_json(("refresh-schedule", "status", "--json")),
            self.git_status(),
        )
        return {
            "vaultRoot": str(self.vault_root),
            "backup": backup,
            "upgrade": upgrade,
            "upgradeDoctor": doctor,
            "deps": deps,
            "refreshSchedule": refresh,
            "git": git_status,
        }

    async def run_json(self, args: tuple[str, ...], allow_failure: bool = False) -> dict[str, Any]:
        command = self.resolved_command()
        process = await asyncio.create_subprocess_exec(
            command,
            *args,
            cwd=self.vault_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        text = stdout.decode(errors="replace").strip()
        if process.returncode not in {0, None} and not allow_failure:
            return {"error": stderr.decode(errors="replace").strip() or text, "returncode": process.returncode}
        try:
            value = json.loads(text or "{}")
        except json.JSONDecodeError:
            return {
                "error": "invalid-json",
                "stdout": text,
                "stderr": stderr.decode(errors="replace").strip(),
                "returncode": process.returncode,
            }
        if isinstance(value, dict):
            value.setdefault("returncode", process.returncode)
            return value
        return {"value": value, "returncode": process.returncode}

    async def git_status(self) -> dict[str, Any]:
        process = await asyncio.create_subprocess_exec(
            "git",
            "status",
            "--short",
            cwd=self.vault_root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        lines = [line for line in stdout.decode(errors="replace").splitlines() if line.strip()]
        return {
            "dirty": bool(lines),
            "changes": lines[:25],
            "error": stderr.decode(errors="replace").strip() if process.returncode else "",
            "returncode": process.returncode,
        }

    def resolved_command(self) -> str:
        if self.vault_command == "vault":
            local = self.vault_root / "_system/commands/vault.py"
            if local.exists():
                return str(local)
        return self.vault_command

