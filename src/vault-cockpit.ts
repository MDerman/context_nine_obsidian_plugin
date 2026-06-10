import { ItemView, Notice, type IconName, type WorkspaceLeaf } from "obsidian";
import type ContextNinePlugin from "./main";
import {
  FALLBACK_VAULT_COMMANDS,
  loadVaultCommandMetadata,
  type VaultCommandDefinition,
} from "./vault-command-metadata";
import { VaultCommandRunner, type VaultRunFinish, type VaultRunSpec, type VaultRunStatus, type VaultStream } from "./vault-runner";

export const VAULT_COCKPIT_VIEW_TYPE = "vault-cockpit-view";

interface LogEntry {
  stream: VaultStream | "system";
  text: string;
}

export class VaultCockpitView extends ItemView {
  private readonly runner = new VaultCommandRunner();
  private commands: VaultCommandDefinition[] = FALLBACK_VAULT_COMMANDS;
  private status: VaultRunStatus = "idle";
  private activeCommandId: string | null = null;
  private actionsExpanded = false;
  private outputExpanded = false;
  private logEntries: LogEntry[] = [];
  private statusEl!: HTMLElement;
  private logContainerEl!: HTMLElement;
  private logEl: HTMLElement | null = null;
  private buttons = new Map<string, HTMLButtonElement>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ContextNinePlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VAULT_COCKPIT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Vault Command Center";
  }

  getIcon(): IconName {
    return "square-terminal";
  }

  async onOpen(): Promise<void> {
    const result = await loadVaultCommandMetadata(this.app);
    this.commands = result.commands;
    if (result.warning) {
      this.logEntries.push({ stream: "system", text: `Warning: ${result.warning}\n` });
    }
    this.render();
  }

  async onClose(): Promise<void> {
    this.runner.kill();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("omp-vault-cockpit");
    containerEl.toggleClass("is-actions-expanded", this.actionsExpanded);

    this.buttons.clear();

    const primaryRow = containerEl.createDiv({ cls: "omp-vault-cockpit-primary-row" });
    const refreshCommand = this.findCommand("refresh") ?? this.commands[0];
    if (refreshCommand) {
      const refreshButton = this.createCommandButton(primaryRow, refreshCommand, "omp-vault-cockpit-refresh");
      this.buttons.set(refreshCommand.id, refreshButton);
    }

    this.statusEl = primaryRow.createDiv({ cls: "omp-vault-cockpit-status", text: labelForStatus(this.status) });
    this.statusEl.dataset.status = this.status;

    const actionsToggle = primaryRow.createEl("button", {
      cls: "omp-vault-cockpit-actions-toggle",
      attr: {
        "aria-label": this.actionsExpanded ? "Hide console controls" : "Show console controls",
        "aria-expanded": String(this.actionsExpanded),
        title: this.actionsExpanded ? "Hide console controls" : "Show console controls",
      },
    });
    actionsToggle.createSpan({
      cls: "omp-vault-cockpit-actions-toggle-icon",
      text: this.actionsExpanded ? "▴" : "▾",
    });
    actionsToggle.addEventListener("click", () => {
      this.actionsExpanded = !this.actionsExpanded;
      this.render();
    });

    if (this.actionsExpanded) {
      this.logContainerEl = containerEl.createDiv({ cls: "omp-vault-cockpit-output" });
      this.renderOutput();
    } else {
      this.logEl = null;
    }
    this.renderStatus();
  }

  private createCommandButton(parent: HTMLElement, command: VaultCommandDefinition, extraClass = ""): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `omp-vault-cockpit-command ${extraClass}`.trim(),
      text: command.label,
      attr: {
        title: command.description,
        "aria-label": command.description,
      },
    });
    button.addEventListener("click", () => {
      this.runCommand(command);
    });
    return button;
  }

  private findCommand(id: string): VaultCommandDefinition | undefined {
    return this.commands.find((command) => command.id === id);
  }

  private runGitCommit(): void {
    if (this.runner.running) {
      new Notice("A vault command is already running.");
      return;
    }

    const message = `Commit at ${formatCommitDate(new Date())}`;
    const script = [
      "git add -A",
      "if git diff --cached --quiet; then",
      "  echo 'No changes to commit.'",
      "else",
      `  git commit -m ${shellQuote(message)}`,
      "fi",
    ].join("\n");
    const spec: VaultRunSpec = {
      id: "git-commit",
      label: "Git commit",
      args: ["-lc", script],
    };

    const started = this.runner.run(spec, "sh", this.plugin.settings.vaultRoot, {
      onStart: (event) => {
        this.status = "running";
        this.activeCommandId = spec.id;
        this.appendLog("system", `\n$ git add -A && git commit -m ${shellQuote(message)}\n`);
        this.appendLog("system", `Started ${formatTime(event.startedAt)} in ${event.cwd}\n`);
        this.renderStatus();
      },
      onOutput: (stream, text) => this.appendLog(stream, text),
      onFinish: (event) => this.finishRun(event),
      onError: (error) => {
        this.status = "failed";
        this.activeCommandId = null;
        this.actionsExpanded = true;
        this.outputExpanded = true;
        this.appendLog("stderr", `${error.message}\n`);
        this.render();
        new Notice(`Git commit failed: ${error.message}`);
      },
    });
    if (!started) {
      new Notice("A vault command is already running.");
    }
  }

  runCommand(command: VaultCommandDefinition, extraArgs: string[] = []): void {
    if (this.runner.running) {
      new Notice("A vault command is already running.");
      return;
    }

    const spec: VaultRunSpec = {
      id: command.id,
      label: command.label,
      args: [...command.args, ...extraArgs],
    };
    const started = this.runner.run(spec, this.plugin.settings.vaultCommand, this.plugin.settings.vaultRoot, {
      onStart: (event) => {
        this.status = "running";
        this.activeCommandId = command.id;
        this.appendLog("system", `\n$ ${event.command} ${event.spec.args.join(" ")}\n`);
        this.appendLog("system", `Started ${formatTime(event.startedAt)} in ${event.cwd}\n`);
        this.renderStatus();
      },
      onOutput: (stream, text) => this.appendLog(stream, text),
      onFinish: (event) => this.finishRun(event),
      onError: (error) => {
        this.status = "failed";
        this.activeCommandId = null;
        this.actionsExpanded = true;
        this.outputExpanded = true;
        this.appendLog("stderr", `${error.message}\n`);
        this.render();
        new Notice(`Vault command failed: ${error.message}`);
      },
    });
    if (!started) {
      new Notice("A vault command is already running.");
    }
  }

  private finishRun(event: VaultRunFinish): void {
    this.status = event.status;
    this.activeCommandId = null;
    if (event.status === "failed") {
      this.actionsExpanded = true;
      this.outputExpanded = true;
    }
    this.appendLog(
      "system",
      `Finished ${formatTime(event.finishedAt)} with exit code ${event.exitCode ?? "null"}${event.signal ? ` (${event.signal})` : ""}\n`
    );
    if (event.status === "failed") {
      this.render();
    } else {
      this.renderStatus();
    }
    new Notice(
      event.status === "succeeded"
        ? `Vault command succeeded: ${event.spec.label}`
        : `Vault command failed: ${event.spec.label}`
    );
  }

  private appendLog(stream: LogEntry["stream"], text: string): void {
    this.logEntries.push({ stream, text });
    this.renderOutput();
  }

  private renderStatus(): void {
    if (this.statusEl) {
      this.statusEl.setText(labelForStatus(this.status));
      this.statusEl.dataset.status = this.status;
    }
    for (const [id, button] of this.buttons) {
      button.disabled = this.status === "running" && id === this.activeCommandId;
    }
  }

  private renderOutput(): void {
    if (!this.logContainerEl) {
      return;
    }
    this.logContainerEl.empty();
    const row = this.logContainerEl.createDiv({ cls: "omp-vault-cockpit-output-row" });
    const toggle = row.createEl("button", {
      cls: "omp-vault-cockpit-output-toggle",
      text: `${this.outputExpanded ? "Hide" : "Show"} Console Output`,
      attr: {
        "aria-expanded": String(this.outputExpanded),
      },
    });
    toggle.addEventListener("click", () => {
      this.outputExpanded = !this.outputExpanded;
      this.renderOutput();
    });

    const commitButton = row.createEl("button", { cls: "omp-vault-cockpit-git-commit", text: "Git Commit" });
    commitButton.disabled = this.status === "running";
    commitButton.addEventListener("click", () => this.runGitCommit());
    this.buttons.set("git-commit", commitButton);

    this.statusEl = row.createDiv({ cls: "omp-vault-cockpit-status", text: labelForStatus(this.status) });
    this.statusEl.dataset.status = this.status;

    if (!this.outputExpanded) {
      this.logEl = null;
      return;
    }

    const actions = this.logContainerEl.createDiv({ cls: "omp-vault-cockpit-log-actions" });
    actions.createEl("button", { text: "Clear" }).addEventListener("click", () => {
      this.logEntries = [];
      this.renderOutput();
    });
    actions.createEl("button", { text: "Copy" }).addEventListener("click", () => {
      void navigator.clipboard.writeText(this.logEntries.map((entry) => entry.text).join(""));
      new Notice("Copied vault command center output.");
    });

    this.logEl = this.logContainerEl.createDiv({ cls: "omp-vault-cockpit-log" });
    this.logEl.empty();
    for (const entry of this.logEntries) {
      const line = this.logEl.createDiv({ cls: `omp-vault-cockpit-log-line is-${entry.stream}` });
      line.setText(entry.text);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}

function labelForStatus(status: VaultRunStatus): string {
  if (status === "idle") return "Idle";
  if (status === "running") return "Running";
  if (status === "succeeded") return "Succeeded";
  return "Failed";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatCommitDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
