from __future__ import annotations

import asyncio
import errno
import os
import pty
import subprocess
from pathlib import Path
from typing import Awaitable, Callable


PtyOutputCallback = Callable[[str], Awaitable[None]]


class PtySession:
    def __init__(self, vault_root: Path, command: str, args: tuple[str, ...]) -> None:
        self.vault_root = vault_root
        self.command = command
        self.args = args
        self.master_fd: int | None = None
        self.process: subprocess.Popen[bytes] | None = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    async def start(self, on_output: PtyOutputCallback) -> int:
        master_fd, slave_fd = pty.openpty()
        self.master_fd = master_fd
        try:
            self.process = subprocess.Popen(
                [self.command, *self.args],
                cwd=self.vault_root,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                close_fds=True,
            )
        finally:
            os.close(slave_fd)
        await on_output(f"$ {self.command} {' '.join(self.args)}\n")
        try:
            while self.running:
                try:
                    chunk = await asyncio.to_thread(os.read, master_fd, 4096)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                await on_output(chunk.decode(errors="replace"))
            return self.process.wait() if self.process else 1
        finally:
            os.close(master_fd)
            self.master_fd = None

    def write(self, text: str) -> None:
        if self.master_fd is not None:
            os.write(self.master_fd, text.encode())

    def terminate(self) -> None:
        if self.running and self.process:
            self.process.terminate()
