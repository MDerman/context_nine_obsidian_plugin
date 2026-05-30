import { Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { join } from "path";
import { AttachmentRouter, noticeRouteResult } from "./attachment-router";
import { FileActionService } from "./file-actions";
import { TaskCaptureService } from "./task-capture";
import { DEFAULT_SETTINGS, MasterPluginSettings } from "./types";
import { VAULT_COCKPIT_VIEW_TYPE, VaultCockpitView } from "./vault-cockpit";
import { TaskContextRouterService } from "./task-context-router";
import { TaskNotesUxService } from "./tasknotes-ux";
import { TaskNotesModalUiService } from "./tasknotes-modal-ui";
import {
  loadVaultCommandMetadata,
  type VaultCommandDefinition,
} from "./vault-command-metadata";

export default class ContextNinePlugin extends Plugin {
  settings: MasterPluginSettings;
  private router: AttachmentRouter;
  private taskCapture: TaskCaptureService;
  private fileActions: FileActionService;
  private taskContextRouter: TaskContextRouterService;
  private taskNotesUx: TaskNotesUxService;
  private taskNotesModalUi: TaskNotesModalUiService;
  private queuedInboxPaths = new Set<string>();
  private gcalSyncProcess: ChildProcessWithoutNullStreams | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.router = new AttachmentRouter(this.app, () => this.settings);
    this.fileActions = new FileActionService(this.app);
    this.taskContextRouter = new TaskContextRouterService(this.app, () => this.settings);
    this.taskNotesUx = new TaskNotesUxService(this.app);
    this.taskNotesModalUi = new TaskNotesModalUiService(this.app, () => this.settings);
    this.taskCapture = new TaskCaptureService(
      this.app,
      this.router,
      () => this.settings,
      () => this.saveSettings()
    );

    this.registerView(
      VAULT_COCKPIT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new VaultCockpitView(leaf, this)
    );

    this.addRibbonIcon("square-terminal", "Open vault command center", () => {
      void this.openVaultCockpit();
    });

    this.addCommand({
      id: "open-vault-cockpit",
      name: "Open vault command center",
      callback: () => {
        void this.openVaultCockpit();
      },
    });

    await this.registerVaultPaletteCommands();

    this.addCommand({
      id: "focus-main-pane-1",
      name: "Focus first main pane",
      callback: () => {
        void this.focusMainPane(0);
      },
    });

    this.addCommand({
      id: "focus-main-pane-2",
      name: "Focus second main pane",
      callback: () => {
        void this.focusMainPane(1, true);
      },
    });

    this.addCommand({
      id: "focus-right-sidebar",
      name: "Focus right sidebar",
      callback: () => {
        void this.focusRightSidebar();
      },
    });

    this.addCommand({
      id: "capture-selection-to-task",
      name: "Capture selection to new TaskNotes task",
      hotkeys: [
        {
          modifiers: ["Alt", "Mod"],
          key: "T",
        },
      ],
      editorCallback: (editor) => {
        void this.taskCapture.captureSelectionToNewTask(editor);
      },
    });

    this.addCommand({
      id: "capture-selection-to-new-task",
      name: "Capture selection to new TaskNotes task",
      editorCallback: (editor) => {
        void this.taskCapture.captureSelectionToNewTask(editor);
      },
    });

    this.addCommand({
      id: "append-selection-to-existing-task",
      name: "Append selection to existing TaskNotes task",
      hotkeys: [
        {
          modifiers: ["Alt", "Mod"],
          key: "Y",
        },
      ],
      editorCallback: (editor) => {
        void this.taskCapture.appendSelectionToExistingTask(editor);
      },
    });

    this.addCommand({
      id: "delete-hovered-or-active-file",
      name: "Delete hovered or selected file",
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "Backspace",
        },
      ],
      callback: () => {
        void this.fileActions.deleteHoveredOrActiveFile();
      },
    });

    this.addCommand({
      id: "new-note-in-hovered-folder",
      name: "New note in hovered folder",
      hotkeys: [
        {
          modifiers: ["Mod"],
          key: "N",
        },
      ],
      callback: () => {
        void this.fileActions.createNoteInHoveredFolder();
      },
    });

    this.addCommand({
      id: "route-attachment-inbox-now",
      name: "Route attachment inbox now",
      callback: () => {
        void this.routeAttachmentInboxNow();
      },
    });

    this.addCommand({
      id: "route-task-files-by-context",
      name: "Route TaskNotes files by context",
      callback: () => {
        void this.routeTaskFilesByContext();
      },
    });

    if (this.settings.enableAutoAttachmentRouter) {
      this.registerAttachmentWatcher();
    }
    if (this.settings.enableGcalSync) {
      this.registerGcalSyncTimer();
    }
    if (this.settings.enableTaskContextRouter) {
      this.taskContextRouter.register(this);
    }
    if (this.settings.hoveredDeleteEnabled) {
      this.fileActions.register(this);
    }
    if (this.settings.taskModalDeleteButtonEnabled) {
      this.taskNotesModalUi.register(this);
    }
    this.taskNotesUx.register(this);

    this.addSettingTab(new ObsidianMasterSettingTab(this));
  }

  onunload(): void {
    this.taskNotesModalUi?.unpatch();
    this.taskNotesUx?.unpatch();
  }

  async loadSettings(): Promise<void> {
    const loadedSettings = (await this.loadData()) as Partial<MasterPluginSettings> | null;
    const currentVaultRoot = this.getCurrentVaultRoot();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedSettings,
      vaultRoot: currentVaultRoot || loadedSettings?.vaultRoot || DEFAULT_SETTINGS.vaultRoot,
    };
    if (currentVaultRoot && loadedSettings?.vaultRoot !== currentVaultRoot) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getCurrentVaultRoot(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    return adapter.getBasePath?.() ?? "";
  }

  getVaultCommand(command: string, cwd: string): string {
    return command === "vault" ? join(cwd, "_master/system/scripts/vault.py") : command;
  }

  async openVaultCockpit(): Promise<void> {
    await this.getVaultCockpitView();
  }

  async getVaultCockpitView(): Promise<VaultCockpitView | null> {
    const existing = this.app.workspace.getLeavesOfType(VAULT_COCKPIT_VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return existing.view instanceof VaultCockpitView ? existing.view : null;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Could not open the right sidebar.");
      return null;
    }
    await leaf.setViewState({ type: VAULT_COCKPIT_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof VaultCockpitView ? leaf.view : null;
  }

  private async registerVaultPaletteCommands(): Promise<void> {
    const result = await loadVaultCommandMetadata(this.app);
    if (result.warning) {
      console.warn(`[Context Nine] ${result.warning}`);
    }
    for (const command of result.commands.filter((item) => item.palette)) {
      this.addCommand({
        id: `vault-${command.id}`,
        name: `Vault ${command.label}`,
        callback: () => {
          void this.runPaletteVaultCommand(command);
        },
      });
    }
  }

  private async runPaletteVaultCommand(command: VaultCommandDefinition): Promise<void> {
    if (command.promptArgs?.length) {
      new VaultPromptArgsModal(this.app, command, (extraArgs) => {
        void this.runVaultCommandInCockpit(command, extraArgs);
      }).open();
      return;
    }
    await this.runVaultCommandInCockpit(command);
  }

  private async runVaultCommandInCockpit(command: VaultCommandDefinition, extraArgs: string[] = []): Promise<void> {
    const view = await this.getVaultCockpitView();
    if (!view) {
      new Notice("Could not open the vault command center.");
      return;
    }
    view.runCommand(command, extraArgs);
  }

  private async focusMainPane(index: number, createIfMissing = false): Promise<void> {
    const leaves = this.getMainPaneLeaves();
    let leaf = leaves[index];

    if (!leaf && createIfMissing && index === 1 && leaves[0]) {
      leaf = this.app.workspace.createLeafBySplit(leaves[0], "vertical");
    }

    if (!leaf) {
      new Notice(`Could not find main pane ${index + 1}.`);
      return;
    }

    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private async focusRightSidebar(): Promise<void> {
    this.app.workspace.rightSplit.expand();
    const leaf =
      this.app.workspace.getMostRecentLeaf(this.app.workspace.rightSplit) ??
      this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      new Notice("Could not focus the right sidebar.");
      return;
    }

    await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private getMainPaneLeaves(): WorkspaceLeaf[] {
    const leaves: WorkspaceLeaf[] = [];
    this.app.workspace.iterateRootLeaves((leaf) => {
      leaves.push(leaf);
    });
    return leaves;
  }

  private registerAttachmentWatcher(): void {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && this.router.isInboxPath(file.path)) {
          this.queuedInboxPaths.add(file.path);
        }
      })
    );

    const interval = Math.max(5, this.settings.routeIntervalSeconds) * 1000;
    this.registerInterval(
      window.setInterval(() => {
        void this.flushAttachmentQueue();
      }, interval)
    );
  }

  private async flushAttachmentQueue(): Promise<void> {
    if (this.queuedInboxPaths.size === 0) {
      return;
    }
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      return;
    }
    const paths = new Set(this.queuedInboxPaths);
    this.queuedInboxPaths.clear();
    try {
      await this.router.routeInboxForActiveNote(activeFile, paths);
    } catch (error) {
      console.error("Attachment queue routing failed", error);
      for (const path of paths) {
        this.queuedInboxPaths.add(path);
      }
    }
  }

  private async routeAttachmentInboxNow(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("Open the note that owns the pasted attachment, then run this command again.");
      return;
    }
    const count = await this.router.routeInboxForActiveNote(activeFile);
    noticeRouteResult(count);
  }

  private async routeTaskFilesByContext(): Promise<void> {
    const moved = await this.taskContextRouter.routeAllTasks();
    new Notice(`Moved ${moved} task file${moved === 1 ? "" : "s"}.`);
  }

  private registerGcalSyncTimer(): void {
    const interval = Math.max(60, this.settings.gcalSyncIntervalSeconds) * 1000;
    this.registerInterval(
      window.setInterval(() => {
        this.runGcalSync();
      }, interval)
    );
  }

  private runGcalSync(): void {
    if (this.gcalSyncProcess) {
      return;
    }

    const cwd = this.settings.vaultRoot || this.getCurrentVaultRoot() || DEFAULT_SETTINGS.vaultRoot;
    const command = this.getVaultCommand(
      this.settings.vaultCommand || DEFAULT_SETTINGS.vaultCommand,
      cwd
    );
    const child = spawn(command, ["gcal", "sync-tasks", "--apply"], {
      cwd,
      env: {
        ...process.env,
        PATH: process.env.PATH
          ? `${process.env.HOME}/.local/bin:${process.env.PATH}`
          : `${process.env.HOME}/.local/bin`,
      },
    });

    this.gcalSyncProcess = child;
    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.log("[Context Nine] gcal sync:", text);
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.warn("[Context Nine] gcal sync:", text);
      }
    });
    child.on("error", (error) => {
      this.gcalSyncProcess = null;
      console.error("[Context Nine] gcal sync failed", error);
    });
    child.on("close", (exitCode) => {
      this.gcalSyncProcess = null;
      if (exitCode !== 0) {
        console.warn(`[Context Nine] gcal sync exited with ${exitCode}`);
      }
    });
  }
}

class VaultPromptArgsModal extends Modal {
  private values: string[];

  constructor(
    app: App,
    private readonly command: VaultCommandDefinition,
    private readonly onSubmit: (args: string[]) => void
  ) {
    super(app);
    this.values = new Array(command.promptArgs?.length ?? 0).fill("");
  }

  onOpen(): void {
    this.contentEl.empty();
    this.containerEl.addClass("omp-modal");
    this.titleEl.setText(this.command.label);

    const promptArgs = this.command.promptArgs ?? [];
    promptArgs.forEach((promptArg, index) => {
      new Setting(this.contentEl).setName(promptArg.label).addText((text) => {
        text.setPlaceholder(promptArg.placeholder ?? "").onChange((value) => {
          this.values[index] = value.trim();
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.submit();
          }
        });
        if (index === 0) {
          window.setTimeout(() => text.inputEl.focus(), 0);
        }
      });
    });

    const buttons = this.contentEl.createDiv({ cls: "omp-button-row" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const run = buttons.createEl("button", { text: "Run" });
    run.addClass("mod-cta");
    run.addEventListener("click", () => this.submit());
  }

  private submit(): void {
    const promptArgs = this.command.promptArgs ?? [];
    const missing = promptArgs.find((_, index) => !this.values[index]);
    if (missing) {
      new Notice(`${missing.label} required.`);
      return;
    }
    this.close();
    this.onSubmit(this.values);
  }
}

class ObsidianMasterSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: ContextNinePlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Context Nine" });

    new Setting(containerEl).setName("Default capture context").addText((text) => {
      text.setValue(this.plugin.settings.defaultContext).onChange(async (value) => {
        this.plugin.settings.defaultContext = value.trim() || DEFAULT_SETTINGS.defaultContext;
        if (!this.plugin.settings.lastContext) {
          this.plugin.settings.lastContext = this.plugin.settings.defaultContext;
        }
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Attachment inbox path").addText((text) => {
      text.setValue(this.plugin.settings.attachmentInboxPath).onChange(async (value) => {
        this.plugin.settings.attachmentInboxPath =
          value.trim() || DEFAULT_SETTINGS.attachmentInboxPath;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Auto-route attachment inbox").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.enableAutoAttachmentRouter).onChange(async (value) => {
        this.plugin.settings.enableAutoAttachmentRouter = value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Route interval seconds").addText((text) => {
      text.setValue(String(this.plugin.settings.routeIntervalSeconds)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.routeIntervalSeconds = Number.isFinite(parsed)
          ? Math.max(5, parsed)
          : DEFAULT_SETTINGS.routeIntervalSeconds;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Auto-sync Google Calendar tasks").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.enableGcalSync).onChange(async (value) => {
        this.plugin.settings.enableGcalSync = value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Google Calendar sync interval seconds").addText((text) => {
      text.setValue(String(this.plugin.settings.gcalSyncIntervalSeconds)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.gcalSyncIntervalSeconds = Number.isFinite(parsed)
          ? Math.max(60, parsed)
          : DEFAULT_SETTINGS.gcalSyncIntervalSeconds;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Move TaskNotes files when context changes").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.enableTaskContextRouter).onChange(async (value) => {
        this.plugin.settings.enableTaskContextRouter = value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Hovered file actions").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.hoveredDeleteEnabled).onChange(async (value) => {
        this.plugin.settings.hoveredDeleteEnabled = value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("TaskNotes edit modal enhancements").addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.taskModalDeleteButtonEnabled).onChange(async (value) => {
        this.plugin.settings.taskModalDeleteButtonEnabled = value;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Vault command").addText((text) => {
      text.setValue(this.plugin.settings.vaultCommand).onChange(async (value) => {
        this.plugin.settings.vaultCommand = value.trim() || DEFAULT_SETTINGS.vaultCommand;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Vault root").addText((text) => {
      text.setValue(this.plugin.settings.vaultRoot).onChange(async (value) => {
        this.plugin.settings.vaultRoot =
          value.trim() || this.plugin.getCurrentVaultRoot() || DEFAULT_SETTINGS.vaultRoot;
        await this.plugin.saveSettings();
      });
    });
  }
}
