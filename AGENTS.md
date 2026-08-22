# Repository instructions

This repository owns the public Context Nine Obsidian plugin and the Vault TUI source bundled with the public Context Vault.

- Release the Obsidian plugin through exact GitHub tags with `main.js`, `manifest.json`, and `styles.css` assets.
- Keep `package.json`, `manifest.json`, and `versions.json` versions aligned.
- The Python TUI is a Context Vault capability, not a standalone `ctx9` launcher component. Its dependency contract remains with the public Vault.
- Never publish Vault content, credentials, machine-local state, or generated Obsidian workspace state from this repository.
- Run the JavaScript and Python focused suites before release.
