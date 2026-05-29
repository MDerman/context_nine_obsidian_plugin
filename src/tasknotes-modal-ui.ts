import { App, Menu, Modal, Notice, Plugin, Setting, TFile, TFolder, normalizePath } from "obsidian";
import { spawn } from "child_process";
import { firstContextValue } from "./task-context";
import {
  entityLink,
  firstStringValue,
  linkLabel,
  vaultCreateArgs,
  type VaultEntityChoice,
} from "./task-modal-fields";
import {
  getTaskNotesField,
  getTaskNotesPlugin,
  notifyTaskNotesChanged,
} from "./tasknotes";
import type { MasterPluginSettings, TaskInfoLike, TaskNotesPluginLike } from "./types";

export class TaskNotesModalUiService {
  private patchRestore: (() => void) | null = null;
  private observer: MutationObserver | null = null;
  private closers = new WeakMap<HTMLElement, () => void>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => MasterPluginSettings
  ) {}

  register(plugin: Plugin): void {
    this.registerObserver(plugin);
    const patch = (): void => this.patchTaskNotesModal(getTaskNotesPlugin(this.app));
    this.app.workspace.onLayoutReady(() => {
      patch();
      window.setTimeout(patch, 500);
      window.setTimeout(patch, 1500);
      window.setTimeout(() => this.enhanceVisibleTaskModals(), 0);
    });
  }

  unpatch(): void {
    this.patchRestore?.();
  }

  patchTaskNotesModal(taskNotes: TaskNotesPluginLike | null): void {
    const original = taskNotes?.openTaskEditModal;
    if (!taskNotes || !original || this.patchRestore) {
      return;
    }

    taskNotes.openTaskEditModal = (task, onTaskUpdated) => {
      const openedModals: Modal[] = [];
      const originalOpen = Modal.prototype.open;
      Modal.prototype.open = function (this: Modal): void {
        originalOpen.call(this);
        openedModals.push(this);
      };

      try {
        original.call(taskNotes, task, onTaskUpdated);
      } finally {
        Modal.prototype.open = originalOpen;
      }

      const enhance = (): void => {
        const modal =
          openedModals.find((candidate) => this.modalMatchesPath(candidate.modalEl, task.path)) ??
          openedModals[openedModals.length - 1];
        if (modal?.modalEl instanceof HTMLElement) {
          modal.modalEl.dataset.ompTaskPath = task.path;
        }
        this.enhanceTaskModal(task, modal?.modalEl, () => modal?.close());
      };
      window.setTimeout(enhance, 100);
      window.setTimeout(enhance, 500);
    };

    this.patchRestore = () => {
      taskNotes.openTaskEditModal = original;
      this.patchRestore = null;
    };
  }

  private registerObserver(plugin: Plugin): void {
    if (this.observer) {
      return;
    }
    const observer = new MutationObserver(() => {
      window.setTimeout(() => this.enhanceVisibleTaskModals(), 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.observer = observer;
    plugin.register(() => {
      observer.disconnect();
      if (this.observer === observer) {
        this.observer = null;
      }
    });
    window.setTimeout(() => this.enhanceVisibleTaskModals(), 0);
  }

  private enhanceVisibleTaskModals(): void {
    for (const modal of Array.from(document.querySelectorAll(".modal"))) {
      if (!(modal instanceof HTMLElement) || modal.hasClass("omp-task-modal-enhanced")) {
        continue;
      }
      const path = this.taskPathFromModal(modal);
      if (path) {
        this.enhanceTaskModal({ path }, modal);
      }
    }
  }

  private enhanceTaskModal(task: Pick<TaskInfoLike, "path" | "title">, modal: Element | undefined, closeModal?: () => void): void {
    if (!(modal instanceof HTMLElement) || modal.hasClass("omp-task-modal-enhanced")) {
      return;
    }
    const file = this.fileForTask(task.path);
    if (!file) {
      return;
    }
    modal.dataset.ompTaskPath = task.path;
    const left = this.leftPanel(modal);
    const title = this.titleBlock(modal);
    if (!(left instanceof HTMLElement) || !(title instanceof HTMLElement)) {
      this.injectDeleteButton(file, modal, closeModal);
      return;
    }

    modal.addClass("omp-task-modal-enhanced");
    if (closeModal) {
      this.closers.set(modal, closeModal);
    }
    this.normalizeTitleLabel(left);
    this.hideNativePrimaryRows(left);

    const primary = left.createDiv({ cls: "omp-task-primary-fields" });
    const divider = left.createDiv({ cls: "omp-task-secondary-divider" });
    title.insertAdjacentElement("afterend", primary);
    primary.insertAdjacentElement("afterend", divider);

    const actionBar = left.querySelector(".action-bar");
    const details = left.querySelector(".details-container");
    if (actionBar instanceof HTMLElement && details instanceof HTMLElement) {
      details.insertAdjacentElement("beforebegin", actionBar);
    }

    const contextButton = this.addDropdownRow(primary, "Context");
    const epicButton = this.addDropdownRow(primary, "Epic");
    const projectButton = this.addDropdownRow(primary, "Project");
    const refresh = (): void => void this.refreshButtons(file, contextButton, epicButton, projectButton);
    contextButton.addEventListener("click", () => void this.openContextMenu(file, contextButton, refresh));
    epicButton.addEventListener("click", () => void this.openEntityMenu("epic", file, epicButton, refresh));
    projectButton.addEventListener("click", () => void this.openEntityMenu("project", file, projectButton, refresh));
    refresh();

    this.injectDeleteButton(file, modal, closeModal);
  }

  private addDropdownRow(parent: HTMLElement, label: string): HTMLButtonElement {
    const row = parent.createDiv({ cls: "omp-task-primary-row" });
    row.createDiv({ cls: "omp-task-primary-label", text: label });
    const button = row.createEl("button", {
      cls: "omp-task-primary-dropdown",
      type: "button",
      text: "None",
    });
    button.setAttr("aria-label", label);
    return button;
  }

  private async refreshButtons(
    file: TFile,
    contextButton: HTMLButtonElement,
    epicButton: HTMLButtonElement,
    projectButton: HTMLButtonElement
  ): Promise<void> {
    const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const taskNotes = getTaskNotesPlugin(this.app);
    const context =
      firstContextValue(metadata?.[getTaskNotesField(taskNotes, "contexts")] ?? metadata?.contexts) ??
      this.contextFromPath(file.path) ??
      this.getSettings().defaultContext;
    contextButton.setText(context);
    epicButton.setText(linkLabel(metadata?.epic) ?? "No epic");
    projectButton.setText(linkLabel(metadata?.[getTaskNotesField(taskNotes, "projects")] ?? metadata?.projects) ?? "No project");
    this.syncNativeInputs(file, context, metadata?.epic, metadata?.projects);
  }

  private async openContextMenu(file: TFile, button: HTMLElement, refresh: () => void): Promise<void> {
    const menu = new Menu();
    for (const context of await this.activeContexts()) {
      menu.addItem((item) => {
        item.setTitle(context).onClick(() => {
          void this.writeTaskFields(file, { contexts: [context] }).then(refresh);
        });
      });
    }
    menu.showAtPosition(this.menuPosition(button));
  }

  private async openEntityMenu(
    kind: "epic" | "project",
    file: TFile,
    button: HTMLElement,
    refresh: () => void
  ): Promise<void> {
    const context = this.currentContext(file);
    const menu = new Menu();
    const choices = this.entityChoices(context, kind === "epic" ? "epics" : "projects");
    menu.addItem((item) => {
      item.setTitle(`New ${kind}...`).setIcon("plus").onClick(() => {
        new EntityNameModal(this.app, `New ${kind}`, async (title) => {
          await this.createEntity(kind, file, context, title);
          refresh();
        }).open();
      });
    });
    menu.addSeparator();
    for (const choice of choices) {
      menu.addItem((item) => {
        item.setTitle(choice.title).onClick(() => {
          const fields = kind === "epic" ? { epic: choice.link } : { projects: [choice.link] };
          void this.writeTaskFields(file, fields).then(refresh);
        });
      });
    }
    menu.showAtPosition(this.menuPosition(button));
  }

  private async createEntity(
    kind: "epic" | "project",
    file: TFile,
    context: string,
    title: string
  ): Promise<void> {
    const epicTitle = kind === "project" ? linkLabel(this.currentFrontmatter(file)?.epic) : null;
    await this.runVault(vaultCreateArgs(kind, context, title, epicTitle));
    const folder = kind === "epic" ? "epics" : "projects";
    const path = normalizePath(`${context}/_obsidian/${folder}/${this.safeFilename(title)}.md`);
    const link = entityLink(path, title);
    await this.writeTaskFields(file, kind === "epic" ? { epic: link } : { projects: [link] });
    new Notice(`Created ${kind}: ${title}`);
  }

  private async writeTaskFields(
    file: TFile,
    fields: { contexts?: string[]; projects?: string[]; epic?: string }
  ): Promise<void> {
    this.syncWrittenFields(file, fields);
    const taskNotes = getTaskNotesPlugin(this.app);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (fields.contexts) {
        frontmatter[getTaskNotesField(taskNotes, "contexts")] = fields.contexts.slice(0, 1);
      }
      if (fields.projects) {
        frontmatter[getTaskNotesField(taskNotes, "projects")] = fields.projects.slice(0, 1);
      }
      if (fields.epic) {
        frontmatter.epic = fields.epic;
      }
      frontmatter[getTaskNotesField(taskNotes, "dateModified")] = new Date().toISOString();
    });
    notifyTaskNotesChanged(taskNotes, file);
  }

  private syncWrittenFields(file: TFile, fields: { contexts?: string[]; projects?: string[]; epic?: string }): void {
    const modal = this.enhancedModalForFile(file);
    if (!modal) {
      return;
    }
    if (fields.contexts?.[0]) {
      this.setInputNearLabel(modal, /^contexts?$/i, fields.contexts[0]);
    }
    if (fields.epic) {
      this.setInputNearText(modal, /choose epic/i, fields.epic);
    }
    if (fields.projects?.[0]) {
      this.setInputNearLabel(modal, /^projects?$/i, fields.projects[0]);
    }
  }

  private runVault(args: string[]): Promise<void> {
    const settings = this.getSettings();
    const command = settings.vaultCommand || "vault";
    const cwd = settings.vaultRoot;
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: {
          ...process.env,
          PATH: process.env.PATH
            ? `${process.env.HOME}/.local/bin:${process.env.PATH}`
            : `${process.env.HOME}/.local/bin`,
        },
      });
      let output = "";
      child.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        output += data.toString();
      });
      child.on("error", (error) => {
        new Notice(`vault ${args.join(" ")} failed: ${error.message}`);
        reject(error);
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const message = output.trim() || `exit ${code}`;
        new Notice(`vault ${args.join(" ")} failed: ${message}`);
        reject(new Error(message));
      });
    });
  }

  private activeContexts(): string[] {
    return this.getSettings().knownRoots.filter((root) => {
      if (!/^\d\d-/.test(root)) {
        return false;
      }
      const home = this.app.vault.getAbstractFileByPath(`${root}/HOME.md`);
      if (!(home instanceof TFile)) {
        return false;
      }
      const cache = this.app.metadataCache.getFileCache(home);
      return cache?.frontmatter?.status === "active";
    });
  }

  private entityChoices(context: string, folderName: "epics" | "projects"): VaultEntityChoice[] {
    const folder = this.app.vault.getAbstractFileByPath(`${context}/_obsidian/${folderName}`);
    if (!(folder instanceof TFolder)) {
      return [];
    }
    return folder.children
      .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
      .map((child) => {
        const title = String(this.app.metadataCache.getFileCache(child)?.frontmatter?.title ?? child.basename);
        return { title, path: child.path, link: entityLink(child.path, title) };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  private currentContext(file: TFile): string {
    const frontmatter = this.currentFrontmatter(file);
    const taskNotes = getTaskNotesPlugin(this.app);
    return (
      firstContextValue(frontmatter?.[getTaskNotesField(taskNotes, "contexts")] ?? frontmatter?.contexts) ??
      this.contextFromPath(file.path) ??
      this.getSettings().defaultContext
    );
  }

  private currentFrontmatter(file: TFile): Record<string, unknown> | undefined {
    return this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
  }

  private contextFromPath(path: string): string | null {
    const root = path.split("/")[0];
    return this.getSettings().knownRoots.includes(root) ? root : null;
  }

  private menuPosition(element: HTMLElement): { x: number; y: number } {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  }

  private normalizeTitleLabel(left: HTMLElement): void {
    const titleLabel = this.labelElement(left, /^title$/i);
    if (titleLabel instanceof HTMLElement) {
      titleLabel.setText("Title");
    }
  }

  private hideNativePrimaryRows(left: HTMLElement): void {
    for (const label of [/^contexts?$/i, /^projects?$/i, /^epic$/i]) {
      const row = this.rowForLabel(left, label);
      row?.addClass("omp-task-modal-native-hidden");
    }
  }

  private syncNativeInputs(file: TFile, context: string, epic: unknown, projects: unknown): void {
    const modal = this.enhancedModalForFile(file);
    if (!modal) {
      return;
    }
    this.setInputNearLabel(modal, /^contexts?$/i, context);
    this.setInputNearText(modal, /choose epic/i, firstStringValue(epic) ?? "");
    this.setInputNearLabel(modal, /^projects?$/i, firstStringValue(projects) ?? "");
  }

  private enhancedModalForFile(file: TFile): HTMLElement | null {
    for (const modal of Array.from(document.querySelectorAll(".modal.omp-task-modal-enhanced"))) {
      if (modal instanceof HTMLElement && this.modalMatchesPath(modal, file.path)) {
        return modal;
      }
    }
    return null;
  }

  private setInputNearLabel(modal: HTMLElement, label: RegExp, value: string): void {
    const row = this.rowForLabel(modal, label);
    if (row) {
      this.setFirstInputValue(row, value);
    }
  }

  private setInputNearText(modal: HTMLElement, text: RegExp, value: string): void {
    const row = Array.from(modal.querySelectorAll(".setting-item")).find((candidate) =>
      text.test(candidate.textContent ?? "")
    );
    if (row instanceof HTMLElement) {
      this.setFirstInputValue(row, value);
    }
  }

  private leftPanel(modal: HTMLElement): HTMLElement | null {
    const splitLeft = modal.querySelector(".modal-split-left");
    if (splitLeft instanceof HTMLElement) {
      return splitLeft;
    }
    const contexts = this.labelElement(modal, /^contexts?$/i);
    const title = this.labelElement(modal, /^title$/i);
    return contexts?.parentElement?.parentElement ?? title?.parentElement?.parentElement ?? null;
  }

  private titleBlock(modal: HTMLElement): HTMLElement | null {
    const known = modal.querySelector(".title-input-container, .nl-markdown-editor");
    if (known instanceof HTMLElement) {
      return known;
    }
    return this.rowForLabel(modal, /^title$/i);
  }

  private rowForLabel(root: HTMLElement, label: RegExp): HTMLElement | null {
    const known = Array.from(root.querySelectorAll(".setting-item")).find((candidate) => {
      const name = candidate.querySelector(".setting-item-name")?.textContent?.trim() ?? "";
      return label.test(name);
    });
    if (known instanceof HTMLElement) {
      return known;
    }
    const labelEl = this.labelElement(root, label);
    return labelEl?.closest(".setting-item, .task-modal__field, .tasknotes-field") as HTMLElement | null
      ?? labelEl?.parentElement ?? null;
  }

  private labelElement(root: HTMLElement, label: RegExp): HTMLElement | null {
    return Array.from(root.querySelectorAll(".setting-item-name, .detail-label, label, div, span")).find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement && label.test(candidate.textContent?.trim() ?? "")
    ) ?? null;
  }

  private setFirstInputValue(parent: HTMLElement, value: string): void {
    const input = parent.querySelector("input");
    if (input instanceof HTMLInputElement) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  private safeFilename(title: string): string {
    return title.replace(/[\\/:*?"<>|\r\n\t]/g, "-").trim() || "Untitled";
  }

  private fileForTask(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  private taskPathFromModal(modal: HTMLElement): string | null {
    const dataPath = modal.dataset.ompTaskPath;
    if (dataPath && this.fileForTask(dataPath)) {
      return dataPath;
    }
    const text = modal.textContent ?? "";
    if (!/Edit task/i.test(text) || !/Task Information/i.test(text)) {
      return null;
    }
    const fileMatch = text.match(/File:\s*([\s\S]+?\.md)/i);
    const path = fileMatch?.[1]?.replace(/\s+/g, " ").replace(/ \/ /g, "/").trim();
    return path && this.fileForTask(path) ? path : null;
  }

  private modalMatchesPath(modal: Element | undefined, taskPath: string): boolean {
    if (!(modal instanceof HTMLElement)) {
      return false;
    }
    if (modal.dataset.ompTaskPath === taskPath) {
      return true;
    }
    const text = modal.textContent ?? "";
    return /Edit task/i.test(text) && text.includes(taskPath);
  }

  private injectDeleteButton(file: TFile, modal: HTMLElement, closeModal?: () => void): void {
    if (closeModal) {
      this.closers.set(modal, closeModal);
    }
    if (modal.querySelector(".omp-delete-task-button")) {
      return;
    }
    const archiveButton = Array.from(modal.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Archive"
    );
    archiveButton?.addClass("omp-archive-task-button");
    const buttonRow =
      archiveButton?.parentElement ??
      modal.querySelector(".modal-button-container") ??
      modal;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete note";
    button.addClass("mod-warning", "omp-delete-task-button");
    button.addEventListener("click", async () => {
      const confirmed = await this.app.fileManager.promptForDeletion(file);
      if (!confirmed) {
        return;
      }
      await this.app.fileManager.trashFile(file);
      new Notice(`File deleted: ${file.path}`);
      this.closeTaskModal(modal);
    });
    if (archiveButton?.parentElement === buttonRow) {
      archiveButton.insertAdjacentElement("afterend", button);
    } else {
      buttonRow.appendChild(button);
    }
  }

  private closeTaskModal(modal: HTMLElement): void {
    const closeModal = this.closers.get(modal);
    if (closeModal) {
      closeModal();
      return;
    }
    const closeButton =
      modal.querySelector(".modal-close-button") ??
      modal.closest(".modal-container")?.querySelector(".modal-close-button");
    if (closeButton instanceof HTMLElement) {
      closeButton.click();
      return;
    }
    modal.closest(".modal-container")?.remove();
  }
}

class EntityNameModal extends Modal {
  private name = "";

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly onSubmit: (name: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("omp-modal");
    new Setting(contentEl).setName(this.titleText).addText((text) => {
      text.onChange((value) => {
        this.name = value.trim();
      });
      text.inputEl.focus();
    });
    const buttons = contentEl.createDiv({ cls: "omp-button-row" });
    buttons.createEl("button", { text: "Cancel", type: "button" }).addEventListener("click", () => {
      this.close();
    });
    const create = buttons.createEl("button", { text: "Create", type: "button", cls: "mod-cta" });
    create.addEventListener("click", async () => {
      if (!this.name) {
        new Notice("Name required.");
        return;
      }
      await this.onSubmit(this.name);
      this.close();
    });
  }
}
