import { App, Menu, Modal, Notice, Plugin, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { dirname, splitExtension } from "./path-utils";
import type { TaskNotesPluginLike } from "./types";

interface HoverTarget {
  path: string;
  kind: "file" | "folder";
}

const PATH_SELECTORS = [
  "[data-task-path]",
  "[data-entry-path]",
  ".nav-file-title[data-path]",
  ".nav-folder-title[data-path]",
  ".tree-item-self[data-path]",
  "[data-path]",
];

export class FileActionService {
  private hoveredTarget: HoverTarget | null = null;
  private lastMousePosition: { x: number; y: number } | null = null;
  private taskModalPatchRestore: (() => void) | null = null;
  private taskModalObserver: MutationObserver | null = null;
  private taskModalClosers = new WeakMap<HTMLElement, () => void>();

  constructor(private readonly app: App) {}

  register(plugin: Plugin): void {
    plugin.registerDomEvent(document, "mousemove", (event) => {
      this.lastMousePosition = { x: event.clientX, y: event.clientY };
      this.hoveredTarget = this.targetFromEvent(event);
    });

    plugin.registerDomEvent(document, "mouseover", (event) => {
      this.lastMousePosition = { x: event.clientX, y: event.clientY };
      this.hoveredTarget = this.targetFromEvent(event);
    });

    plugin.registerDomEvent(document, "mouseout", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const relatedTarget = event.relatedTarget;
      const target = event.target;
      const stillInsidePathTarget =
        relatedTarget instanceof Element &&
        PATH_SELECTORS.some((selector) => relatedTarget.closest(selector));
      if (
        !stillInsidePathTarget &&
        target instanceof Element &&
        PATH_SELECTORS.some((selector) => target.closest(selector))
      ) {
        this.hoveredTarget = null;
      }
    });

    plugin.registerDomEvent(document, "contextmenu", (event) => {
      this.showContextMenu(event);
    });
  }

  patchTaskNotesModal(taskNotes: TaskNotesPluginLike | null): void {
    const pluginLike = taskNotes as
      | (TaskNotesPluginLike & {
          openTaskEditModal?: (task: { path: string; title?: string }, onTaskUpdated?: unknown) => void;
        })
      | null;
    const original = pluginLike?.openTaskEditModal;
    if (!pluginLike || !original || this.taskModalPatchRestore) {
      return;
    }

    pluginLike.openTaskEditModal = (task, onTaskUpdated) => {
      const openedModals: Modal[] = [];
      const originalOpen = Modal.prototype.open;
      Modal.prototype.open = function (this: Modal): void {
        originalOpen.call(this);
        openedModals.push(this);
      };

      try {
        original.call(pluginLike, task, onTaskUpdated);
      } finally {
        Modal.prototype.open = originalOpen;
      }

      const inject = (): void => {
        const taskModal =
          openedModals.find((modal) => this.taskModalElementMatchesPath(modal.modalEl, task.path)) ??
          openedModals[openedModals.length - 1];

        if (taskModal) {
          this.injectDeleteIntoTaskModalElement(task.path, taskModal.modalEl, () => taskModal.close());
          return;
        }

        this.injectDeleteIntoTaskModal(task.path);
      };

      window.setTimeout(inject, 100);
      window.setTimeout(inject, 500);
    };

    this.taskModalPatchRestore = () => {
      pluginLike.openTaskEditModal = original;
      this.taskModalPatchRestore = null;
    };
  }

  unpatchTaskNotesModal(): void {
    this.taskModalPatchRestore?.();
  }

  registerTaskModalDeleteObserver(plugin: Plugin): void {
    if (this.taskModalObserver) {
      return;
    }
    const scan = (): void => this.injectDeleteIntoVisibleTaskModals();
    const observer = new MutationObserver(() => {
      window.setTimeout(scan, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.taskModalObserver = observer;
    plugin.register(() => {
      observer.disconnect();
      if (this.taskModalObserver === observer) {
        this.taskModalObserver = null;
      }
    });
    window.setTimeout(scan, 0);
  }

  async deleteHoveredOrActiveFile(): Promise<void> {
    const target = this.resolveTarget();
    if (!target) {
      new Notice("No hovered or selected file to delete.");
      return;
    }
    await this.deleteFile(target);
  }

  async createNoteInHoveredFolder(): Promise<void> {
    const folder = this.resolveFolderTarget();
    if (!folder) {
      const commands = this.app as unknown as {
        commands?: { executeCommandById?: (commandId: string) => boolean };
      };
      const executed =
        commands.commands?.executeCommandById?.("app:new-file") ??
        commands.commands?.executeCommandById?.("file-explorer:new-file") ??
        false;
      if (!executed) {
        new Notice("Hover a folder in the file explorer first.");
      }
      return;
    }

    const path = await this.uniquePath(folder.path, "Untitled.md");
    const file = await this.app.vault.create(path, "");
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  private showContextMenu(event: MouseEvent): void {
    const target = this.targetFromEvent(event);
    if (!target) {
      return;
    }
    const file = this.abstractFileForTarget(target);
    if (!file) {
      return;
    }

    const menu = new Menu();
    if (file instanceof TFolder) {
      menu.addItem((item) => {
        item.setTitle("New note in folder").setIcon("file-plus").onClick(() => {
          void this.createNoteInFolder(file);
        });
      });
    }
    menu.addItem((item) => {
      item
        .setTitle(file instanceof TFolder ? "Delete folder" : "Delete note")
        .setIcon("trash")
        .onClick(() => {
          void this.deleteFile(file);
        });
    });
    menu.showAtMouseEvent(event);
  }

  private async createNoteInFolder(folder: TFolder): Promise<void> {
    const path = await this.uniquePath(folder.path, "Untitled.md");
    const file = await this.app.vault.create(path, "");
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  private async deleteFile(file: TAbstractFile): Promise<boolean> {
    const confirmed = await this.app.fileManager.promptForDeletion(file);
    if (!confirmed) {
      return false;
    }
    await this.app.fileManager.trashFile(file);
    new Notice(`${file instanceof TFolder ? "Folder" : "File"} deleted: ${file.path}`);
    return true;
  }

  private async uniquePath(folderPath: string, fileName: string): Promise<string> {
    const { stem, ext } = splitExtension(fileName);
    for (let index = 0; index < 500; index += 1) {
      const suffix = index === 0 ? "" : ` ${index + 1}`;
      const path = normalizePath(`${folderPath}/${stem}${suffix}${ext}`);
      if (!(await this.app.vault.adapter.exists(path))) {
        return path;
      }
    }
    throw new Error(`Could not find a free note path in ${folderPath}`);
  }

  private resolveTarget(): TAbstractFile | null {
    const selected = this.selectedExplorerTarget();
    if (selected) {
      return selected;
    }
    if (this.hoveredTarget) {
      const hovered = this.abstractFileForTarget(this.hoveredTarget);
      if (hovered) {
        return hovered;
      }
    }
    const liveHovered = this.targetUnderPointer();
    if (liveHovered) {
      return liveHovered;
    }
    return null;
  }

  private resolveFolderTarget(): TFolder | null {
    const selected = this.selectedExplorerTarget();
    if (selected instanceof TFolder) {
      return selected;
    }
    if (this.hoveredTarget) {
      const hovered = this.abstractFileForTarget(this.hoveredTarget);
      if (hovered instanceof TFolder) {
        return hovered;
      }
      if (hovered instanceof TFile) {
        const parent = this.app.vault.getAbstractFileByPath(dirname(hovered.path));
        return parent instanceof TFolder ? parent : null;
      }
    }
    return null;
  }

  private selectedExplorerTarget(): TAbstractFile | null {
    const selected = document.querySelector(
      ".task-card--selected[data-task-path], .task-card--selected-primary[data-task-path], .nav-file-title.is-active[data-path], .nav-folder-title.is-active[data-path], .tree-item-self.is-active[data-path], .is-selected[data-path], .is-selected[data-task-path]"
    );
    if (!(selected instanceof HTMLElement)) {
      return null;
    }
    const path = selected.getAttribute("data-task-path") ?? selected.getAttribute("data-path");
    return path ? this.app.vault.getAbstractFileByPath(path) : null;
  }

  private targetFromEvent(event: MouseEvent): HoverTarget | null {
    if (!(event.target instanceof Element)) {
      return null;
    }
    return this.targetFromElement(event.target);
  }

  private targetFromElement(element: Element): HoverTarget | null {
    const taskCard = element.closest("[data-task-path]");
    if (taskCard instanceof HTMLElement) {
      const path = taskCard.getAttribute("data-task-path");
      if (path) {
        return { path, kind: "file" };
      }
    }

    const kanbanCard = element.closest("[data-entry-path]");
    if (kanbanCard instanceof HTMLElement) {
      const path = kanbanCard.getAttribute("data-entry-path");
      if (path) {
        return { path, kind: "file" };
      }
    }

    const pathEl = element.closest("[data-path]");
    if (pathEl instanceof HTMLElement) {
      const path = pathEl.getAttribute("data-path");
      if (!path) {
        return null;
      }
      const kind =
        pathEl.classList.contains("nav-folder-title") ||
        pathEl.closest(".nav-folder") ||
        this.app.vault.getAbstractFileByPath(path) instanceof TFolder
          ? "folder"
          : "file";
      return { path, kind };
    }

    const internalLink = element.closest("a.internal-link");
    if (internalLink instanceof HTMLElement) {
      const href = internalLink.getAttribute("data-href") || internalLink.getAttribute("href");
      if (href) {
        const sourcePath =
          internalLink.closest("[data-task-path]")?.getAttribute("data-task-path") ??
          internalLink.closest("[data-entry-path]")?.getAttribute("data-entry-path") ??
          this.app.workspace.getActiveFile()?.path ??
          "";
        const file = this.app.metadataCache.getFirstLinkpathDest(href, sourcePath);
        if (file) {
          return { path: file.path, kind: "file" };
        }
      }
    }

    return null;
  }

  private targetUnderPointer(): TAbstractFile | null {
    if (!this.lastMousePosition) {
      return null;
    }
    const element = document.elementFromPoint(this.lastMousePosition.x, this.lastMousePosition.y);
    if (!(element instanceof Element)) {
      return null;
    }
    const target = this.targetFromElement(element);
    return target ? this.abstractFileForTarget(target) : null;
  }

  private abstractFileForTarget(target: HoverTarget): TAbstractFile | null {
    return this.app.vault.getAbstractFileByPath(target.path);
  }

  private injectDeleteIntoVisibleTaskModals(): void {
    const modals = Array.from(document.querySelectorAll(".modal"));
    for (const modal of modals) {
      if (!(modal instanceof HTMLElement)) {
        continue;
      }
      const taskPath = this.taskPathFromModal(modal);
      if (taskPath) {
        this.injectDeleteIntoTaskModalElement(taskPath, modal);
      }
    }
  }

  private taskPathFromModal(modal: HTMLElement): string | null {
    if (modal.querySelector(".omp-delete-task-button")) {
      return null;
    }
    const text = modal.textContent ?? "";
    if (!/Edit task/i.test(text) || !/Task Information/i.test(text)) {
      return null;
    }
    const fileMatch = text.match(/File:\s*([^\n\r]+?\.md)/i);
    const path = fileMatch?.[1]?.trim();
    if (!path) {
      return null;
    }
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile ? path : null;
  }

  private injectDeleteIntoTaskModal(taskPath: string): void {
    const modals = Array.from(document.querySelectorAll(".modal"));
    const modal = modals[modals.length - 1];
    this.injectDeleteIntoTaskModalElement(taskPath, modal);
  }

  private injectDeleteIntoTaskModalElement(
    taskPath: string,
    modal: Element | undefined,
    closeModal?: () => void
  ): void {
    const file = this.app.vault.getAbstractFileByPath(taskPath);
    if (!(file instanceof TFile)) {
      return;
    }

    if (!(modal instanceof HTMLElement)) {
      return;
    }

    if (closeModal) {
      this.taskModalClosers.set(modal, closeModal);
    }

    if (modal.querySelector(".omp-delete-task-button")) {
      return;
    }

    const archiveButton = this.archiveButtonInModal(modal);
    archiveButton?.addClass("omp-archive-task-button");
    const buttonRow =
      archiveButton?.parentElement ??
      modal.querySelector(".modal-button-container") ??
      modal.querySelector(".setting-item:last-child .setting-item-control") ??
      modal;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Delete note";
    button.addClass("mod-warning", "omp-delete-task-button");
    button.addEventListener("click", async () => {
      const deleted = await this.deleteFile(file);
      if (deleted) {
        this.closeTaskModal(modal);
      }
    });
    if (archiveButton?.parentElement === buttonRow) {
      archiveButton.insertAdjacentElement("afterend", button);
    } else {
      buttonRow.appendChild(button);
    }
  }

  private archiveButtonInModal(modal: HTMLElement): HTMLButtonElement | null {
    const buttons = Array.from(modal.querySelectorAll("button"));
    return buttons.find((button) => button.textContent?.trim() === "Archive") ?? null;
  }

  private taskModalElementMatchesPath(modal: Element | undefined, taskPath: string): boolean {
    if (!(modal instanceof HTMLElement)) {
      return false;
    }
    const text = modal.textContent ?? "";
    return /Edit task/i.test(text) && text.includes(taskPath);
  }

  private closeTaskModal(modal: HTMLElement): void {
    const closeModal = this.taskModalClosers.get(modal);
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
