from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Literal


Stream = Literal["stdout", "stderr"]
OutputCallback = Callable[[Stream, str], Awaitable[None]]


@dataclass(frozen=True)
class RunResult:
    args: tuple[str, ...]
    returncode: int | None


class CommandRunner:
    def __init__(self, vault_root: Path, vault_command: str = "vault") -> None:
        self.vault_root = vault_root
        self.vault_command = vault_command
        self.process: asyncio.subprocess.Process | None = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.returncode is None

    def resolved_command(self) -> str:
        if self.vault_command == "vault":
            local = self.vault_root / "_system/commands/vault.py"
            if local.exists():
                return str(local)
        return self.vault_command

    async def run(self, args: tuple[str, ...], on_output: OutputCallback) -> RunResult:
        if self.running:
            raise RuntimeError("A vault command is already running.")
        env = os.environ.copy()
        home = env.get("HOME", str(Path.home()))
        env["PATH"] = f"{home}/.local/bin:{env.get('PATH', '')}"
        command = self.resolved_command()
        await on_output("stdout", f"$ {command} {' '.join(args)}\n")
        process = await asyncio.create_subprocess_exec(
            command,
            *args,
            cwd=self.vault_root,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self.process = process
        try:
            await asyncio.gather(
                self._pump("stdout", process.stdout, on_output),
                self._pump("stderr", process.stderr, on_output),
            )
            returncode = await process.wait()
            await on_output("stdout", f"\nexit: {returncode}\n")
            return RunResult(args=args, returncode=returncode)
        finally:
            self.process = None

    async def cancel(self) -> None:
        if not self.running or self.process is None:
            return
        self.process.terminate()
        try:
            await asyncio.wait_for(self.process.wait(), timeout=5)
        except asyncio.TimeoutError:
            self.process.kill()
            await self.process.wait()

    async def _pump(
        self,
        stream: Stream,
        reader: asyncio.StreamReader | None,
        on_output: OutputCallback,
    ) -> None:
        if reader is None:
            return
        while True:
            chunk = await reader.readline()
            if not chunk:
                break
            await on_output(stream, chunk.decode(errors="replace"))

