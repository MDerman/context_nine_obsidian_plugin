from __future__ import annotations

import sys

import pytest

from context_nine_vault_tui.runner import CommandRunner


@pytest.mark.asyncio
async def test_runner_streams_stdout_and_stderr(tmp_path):
    runner = CommandRunner(tmp_path, sys.executable)
    events: list[tuple[str, str]] = []

    async def on_output(stream: str, text: str) -> None:
        events.append((stream, text))

    result = await runner.run(
        (
            "-c",
            "import sys; print('out'); print('err', file=sys.stderr)",
        ),
        on_output,
    )

    assert result.returncode == 0
    assert any(stream == "stdout" and "out" in text for stream, text in events)
    assert any(stream == "stderr" and "err" in text for stream, text in events)

