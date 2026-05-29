# Context Nine

TaskNotes capture, context routing, vault command cockpit, and attachment cleanup tools for Obsidian.

Context Nine is desktop-only. Vault Cockpit and background sync commands use local Node.js process APIs.

## Features

- Capture selected Markdown into a new TaskNotes task.
- Append selected Markdown to an existing TaskNotes task under `## Captures`.
- Route attachment links from captured selections into destination context folders.
- Route pasted or dropped inbox attachments from `master/_obsidian/attachments/_inbox`.
- Move TaskNotes files when context fields change.
- Add file delete actions for file explorer items, Bases kanban cards, and TaskNotes edit modals where possible.
- Open a right-sidebar Vault Cockpit for common `vault` terminal commands.

## Commands

| Command | Behavior |
| --- | --- |
| Capture selection to new TaskNotes task | Opens TaskNotes create dialog. If Markdown is selected, injects selection into task details on save, routes selected attachments, then deletes source selection after success. |
| Append selection to existing TaskNotes task | Opens a task picker, appends selected block under `## Captures`, routes selected attachments, then deletes source selection after success. |
| Route inbox attachments for active note | Moves queued inbox attachments into active note context. |
| Route TaskNotes files by context | Moves TaskNotes files to folders matching their context metadata. |
| Delete hovered or selected file | Uses Obsidian delete confirmation and trash behavior. |
| New note in hovered folder | Creates `Untitled.md` in hovered file-explorer folder, falling back to Obsidian new note behavior. |
| Open vault cockpit | Opens command runner panel in right sidebar. |

## Vault Cockpit

Vault Cockpit runs the local `vault` command dispatcher without leaving Obsidian. Default buttons include refresh, sync, context, content schedules, attachment dry run/apply, and profile sync.

Normal click runs a command directly. `Cmd+Click` opens an arguments modal and appends parsed arguments to the base command. Output streams live into the panel with stdout, stderr, status, exit code, and timestamps visible after completion.

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
