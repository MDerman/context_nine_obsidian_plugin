from __future__ import annotations

import argparse
from pathlib import Path

from .app import VaultTuiApp


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open the Context Nine vault command TUI.")
    parser.add_argument("--vault-root", default=None, help="Vault root path. Defaults to current directory.")
    parser.add_argument("--vault-command", default="vault", help="Vault command executable. Defaults to vault.")
    parser.add_argument("--command-columns", type=int, default=5, help="Commands tab grid columns. Defaults to 5.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    vault_root = Path(args.vault_root or ".").expanduser().resolve()
    VaultTuiApp(
        vault_root=vault_root,
        vault_command=args.vault_command,
        command_columns=args.command_columns,
    ).run()
    return 0
