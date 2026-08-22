# Context Nine

TaskNotes capture, context routing, vault command cockpit, and attachment cleanup tools for Obsidian.

Published by [Context Nine (CTX9)](https://ctx9.com/), an enterprise AI strategy and engineering studio founded by Matthew Derman.

Context Nine is desktop-only. Vault Command Center and background sync commands use local Node.js process APIs.

## Features

- Capture selected Markdown into a new TaskNotes task.
- Append selected Markdown to an existing TaskNotes task under `## Captures`.
- Copy the current note's vault-relative directory to the clipboard.
- Route attachment links from captured selections into destination context folders.
- Route pasted or dropped inbox attachments from `_system/_obsidian/attachments/_inbox`.
- Move TaskNotes files when context fields change.
- Add file delete actions for file explorer items, Bases kanban cards, and TaskNotes edit modals where possible.
- Open a right-sidebar Vault Command Center for common `vault` terminal commands.
- Open the full-screen `vault tui` control room for backup/sync, upgrade, command execution, logs, and interactive setup flows.
- Replace open past periodic-note tabs with the current daily, weekly, monthly, quarterly, or yearly note after `vault refresh`.

## Commands

| Command | Behavior |
| --- | --- |
| Capture selection to new TaskNotes task | Opens TaskNotes create dialog. If Markdown is selected, injects selection into task details on save, routes selected attachments, then deletes source selection after success. |
| Append selection to existing TaskNotes task | Opens a task picker, appends selected block under `## Captures`, routes selected attachments, then deletes source selection after success. |
| Copy current note directory | Copies the active note's vault-relative parent directory. Default shortcut on macOS: `Cmd+Option+C`. |
| Route inbox attachments for active note | Moves queued inbox attachments into active note context. |
| Route TaskNotes files by context | Moves TaskNotes files to folders matching their context metadata. |
| Delete hovered or selected file | Uses Obsidian delete confirmation and trash behavior. |
| New note in hovered folder | Creates `Untitled.md` in hovered file-explorer folder, falling back to Obsidian new note behavior. |
| Open vault command center | Opens command runner panel in right sidebar. |
| Refresh past periodic-note tabs | Reuses each stale Markdown leaf for the current note in the same context or vault-rollup scope. Current and future notes stay open. |

## Vault Refresh Handoff

Context Nine reads `_system/state/refresh-complete.json` after startup and whenever `vault refresh` publishes a new successful run. It also exposes the native Obsidian CLI command:

```bash
obsidian context-nine:refresh-periodic-tabs date=2026-07-28 run-id=<refresh-run-id>
```

The marker is the durable fallback when Obsidian or its CLI is unavailable. The plugin never edits `.obsidian/workspace.json`; it updates live Markdown leaves through the Obsidian API.

## Vault Command Center

Vault Command Center shows local command output in the right sidebar and keeps Git preflight and commit actions in its always-visible primary row. Day-to-day vault commands live in the Obsidian command palette and are loaded from the vault command metadata file.

Output streams live into the panel with stdout, stderr, status, exit code, and timestamps visible after completion.

## Vault TUI

The Textual TUI lives under `python/` and is exposed through the vault dispatcher:

```bash
vault tui
```

Development:

```bash
cd python
uv run pytest
uv run vault-tui --vault-root "$(vault root)"
```

The TUI ships with the public Context Vault and follows its dependency installer. It is not a standalone `ctx9` launcher component because it has no useful lifecycle without a Vault.

## Development

```bash
npm install
npm run build
npm run test
VAULT_ROOT="/path/to/vault" npm run install-vault
```

`npm run install-vault` builds the plugin and copies `main.js`, `manifest.json`, and `styles.css` into:

```text
.obsidian/plugins/context-nine/
```

## Release

GitHub releases must include these assets:

- `main.js`
- `manifest.json`
- `styles.css`

Release tag must match `manifest.json` version.
