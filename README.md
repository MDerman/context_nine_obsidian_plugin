# Obsidian Master Plugin

Workspace-specific Obsidian helpers for Matthew's master vault.

This is a local Obsidian community plugin, not a published marketplace plugin. It is developed here:

```text
/Users/matthewderman/Code/Personal/obsidian_master_plugin
```

The built plugin is installed into the vault here:

```text
/Users/matthewderman/My Drive/Workspace/.obsidian/plugins/obsidian-master-plugin
```

## Features

- Capture the current Markdown selection into a new TaskNotes task.
- Append the current Markdown selection to an existing TaskNotes task under `## Captures`.
- Route attachment links in the captured selection into the destination context folder immediately.
- Route new pasted/dropped files from `master/_obsidian/attachments/_inbox` into the active note's root attachment folder.
- Delete hovered or selected files with Obsidian's normal confirmation/trash behavior.
- Create a new note in the hovered file-explorer folder.
- Add delete actions to file explorer items, Bases kanban cards, and TaskNotes edit modals where possible.
- Open a right-sidebar Vault Cockpit for running common `vault` terminal commands from Obsidian.

## Default Shortcuts

These are also documented in the vault note `master/system/obsidian_notes/obsidian-keyboard-shortcuts.md`.

| Shortcut | Command | Behavior |
| --- | --- | --- |
| `Alt+Cmd+T` | Capture selection to new TaskNotes task | Opens the native TaskNotes create dialog. If Markdown is selected, the plugin injects that selection into the task details on save, routes selected attachments immediately, then deletes the source selection after success. With no selection, it behaves like the normal TaskNotes new task dialog. |
| `Alt+Cmd+Y` | Append selection to existing TaskNotes task | Opens a task picker, appends the selected block under `## Captures`, routes selected attachments immediately, then deletes the source selection after success. |
| `Cmd+Backspace` | Delete hovered or selected file | Uses Obsidian's delete confirmation and trash behavior. Works for file explorer selections, hovered file explorer items, and Bases kanban cards that expose a file path. It does not delete the active note as a fallback. |
| `Alt+Cmd+Backspace` | Obsidian: delete current file | Uses Obsidian's native current-file delete command for deliberate current-note deletion. |
| `Cmd+N` | New note in hovered folder | Creates `Untitled.md` in the hovered file-explorer folder. If no folder is hovered, falls back to Obsidian's normal new note command. |

## Vault Cockpit

The Vault Cockpit is a right-sidebar view for running the local `vault` command dispatcher without leaving Obsidian. Open it from the ribbon icon or the command palette command `Open vault cockpit`.

Default buttons:

- Refresh: `vault refresh`
- Sync Apple Notes: `vault sync`
- Context: `vault context`
- Content Schedules: `vault content`
- Attachments Dry Run: `vault attachments`
- Attachments Apply: `vault attachments --apply`
- Obsidian Profile Sync: `vault profile`

Normal click runs the command directly. `Cmd+Click` opens an arguments modal and appends extra parsed arguments to the base command. Output streams live into the panel, with stdout, stderr, status, exit code, and timestamps kept visible after completion.

The plugin is desktop-only because the cockpit uses Node's `child_process.spawn`. Settings expose the command name/path and vault root; defaults are `vault` and `/Users/matthewderman/My Drive/Workspace`.

## Attachment Routing

There are two attachment routing paths:

- Capture commands route selected attachment links immediately. This does not wait for any background timer.
- The inbox router watches `master/_obsidian/attachments/_inbox` and flushes queued new files every 60 seconds. That path is for ordinary paste/drop attachments outside the capture commands.
- When enabled, the plugin runs `vault gcal sync-tasks --apply` every 5 minutes while Obsidian is open.

Destination attachments are flat under the destination root's attachment folder, for example:

```text
03-impression/_obsidian/attachments/
```

If the same file already exists at the destination, the plugin reuses it. If a different file has the same name, it adds a suffix like ` (2)`.

## TaskNotes Integration

For new tasks, the plugin reuses the installed TaskNotes create modal when available. It temporarily wraps TaskNotes' `taskService.createTask` so it can route the selected attachments and inject the selected content at save time.

For existing tasks, the plugin uses TaskNotes' cached task list, appends the capture to the Markdown file, updates `dateModified`, and asks TaskNotes to refresh its cache when available.

## Vault Config

The vault should have:

- `obsidian-master-plugin` enabled in `.obsidian/community-plugins.json`.
- `Alt+Cmd+T`, `Alt+Cmd+Y`, `Cmd+Backspace`, `Alt+Cmd+Backspace`, and `Cmd+N` mapped in `.obsidian/hotkeys.json`.
- Obsidian's attachment folder set to `master/_obsidian/attachments/_inbox`.

The same plugin enablement and hotkey defaults are mirrored into the reusable bootstrap profile under:

```text
master/system/bootstrap/setup/obsidian-profiles/source/.obsidian/
```

## Development

```bash
npm install
npm run build
npm run test
npm run install-vault
```

`npm run install-vault` builds the plugin and copies `main.js`, `manifest.json`, and `styles.css` into the active vault plugin folder.
