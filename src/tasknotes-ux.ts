import { App, Notice, Plugin, TFile, setIcon } from "obsidian";
import { normalizeTaskAliases } from "./tasknotes-aliases";
import {
  buildKanbanTaskDefaults,
  contextFromPathRoot,
  contextFromWikiLinkValue,
  mergeKanbanTaskDefaults,
  normalizeSwimlaneProjectValue,
  parseEpicPathFromBaseText,
} from "./tasknotes-kanban-defaults";
import { getTaskNotesPlugin } from "./tasknotes";
import type { TaskInfoLike, TaskNotesPluginLike } from "./types";

interface EpicChoice {
  label: string;
  path: string;
  link: string;
}

const STATUS_TRIGGER = "$";
const PRIORITY_TRIGGER = "!";
const EPIC_TRIGGER = "^";

export class TaskNotesUxService {
  private modalObserver: MutationObserver | null = null;
  private restoreCreateTask: (() => void) | null = null;
  private restoreKanbanCreateTask: (() => void) | null = null;

  constructor(private readonly app: App) {}

  register(plugin: Plugin): void {
    const configure = (): void => {
      const taskNotes = getTaskNotesPlugin(this.app);
      this.configureNaturalLanguageTriggers(taskNotes);
      this.patchCreateTaskAliases(taskNotes);
    };

    plugin.app.workspace.onLayoutReady(() => {
      configure();
      window.setTimeout(configure, 500);
      window.setTimeout(() => this.enhanceVisibleTaskModals(), 0);
      window.setTimeout(() => this.enhanceVisibleKanbanSwimlaneAddButtons(), 0);
    });

    const observer = new MutationObserver(() => {
      window.setTimeout(() => {
        configure();
        this.enhanceVisibleTaskModals();
        this.enhanceVisibleKanbanSwimlaneAddButtons();
      }, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.modalObserver = observer;
    plugin.register(() => {
      observer.disconnect();
      if (this.modalObserver === observer) {
        this.modalObserver = null;
      }
      this.unpatch();
    });
  }

  unpatch(): void {
    this.restoreKanbanCreateTask?.();
    this.restoreCreateTask?.();
  }

  private configureNaturalLanguageTriggers(taskNotes: TaskNotesPluginLike | null): void {
    const settings = taskNotes?.settings;
    if (!settings) {
      return;
    }

    settings.enableNaturalLanguageInput = true;
    settings.statusSuggestionTrigger = STATUS_TRIGGER;
    const triggers = settings.nlpTriggers?.triggers;
    if (!triggers) {
      return;
    }

    this.setTrigger(triggers, "status", STATUS_TRIGGER, true);
    this.setTrigger(triggers, "priority", PRIORITY_TRIGGER, true);
    this.setTrigger(triggers, "epic", EPIC_TRIGGER, true);
  }

  private setTrigger(
    triggers: Array<{ propertyId: string; trigger: string; enabled: boolean }>,
    propertyId: string,
    trigger: string,
    enabled: boolean
  ): void {
    const existing = triggers.find((item) => item.propertyId === propertyId);
    if (existing) {
      existing.trigger = trigger;
      existing.enabled = enabled;
      return;
    }
    triggers.push({ propertyId, trigger, enabled });
  }

  private patchCreateTaskAliases(taskNotes: TaskNotesPluginLike | null): void {
    const service = taskNotes?.taskService;
    const originalCreate = service?.createTask;
    if (!service || !originalCreate || this.restoreCreateTask) {
      return;
    }

    service.createTask = async (taskData, options) => {
      return originalCreate.call(service, this.normalizeTaskData(taskData), options);
    };

    this.restoreCreateTask = () => {
      service.createTask = originalCreate;
      this.restoreCreateTask = null;
    };
  }

  private normalizeTaskData(taskData: Record<string, unknown>): Record<string, unknown> {
    return normalizeTaskAliases(taskData, this.epicChoices());
  }

  private enhanceVisibleTaskModals(): void {
    const epics = this.epicChoices();
    if (epics.length === 0) {
      return;
    }

    for (const modal of Array.from(document.querySelectorAll(".modal"))) {
      if (modal instanceof HTMLElement) {
        this.enhanceEpicField(modal, epics);
      }
    }
  }

  private enhanceVisibleKanbanSwimlaneAddButtons(): void {
    const taskNotes = getTaskNotesPlugin(this.app);
    if (!taskNotes?.openTaskCreationModal) {
      return;
    }

    for (const column of Array.from(
      document.querySelectorAll(".tasknotes-plugin .kanban-view__swimlane-column")
    )) {
      if (column instanceof HTMLElement) {
        this.enhanceKanbanSwimlaneColumn(column, taskNotes);
      }
    }
  }

  private enhanceKanbanSwimlaneColumn(
    column: HTMLElement,
    taskNotes: TaskNotesPluginLike
  ): void {
    if (column.querySelector(":scope > .omp-kanban-add-task-button")) {
      return;
    }

    const status = column.dataset.column;
    if (!status) {
      return;
    }

    const project = this.normalizeSwimlaneProject(column.dataset.swimlane);
    const button = document.createElement("button");
    button.type = "button";
    button.addClass("clickable-icon", "omp-kanban-add-task-button");
    button.setAttribute("aria-label", this.addTaskButtonLabel(status, project));
    button.setAttribute("title", this.addTaskButtonLabel(status, project));
    button.setAttribute("data-tn-no-drag", "true");
    button.setAttribute("data-tn-click-exclude", "true");
    setIcon(button, "plus");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.openTaskModalForKanbanCell(taskNotes, status, project, column);
    });

    const tasks = column.querySelector(":scope > .kanban-view__tasks-container");
    column.insertBefore(button, tasks ?? column.firstChild);
  }

  private openTaskModalForKanbanCell(
    taskNotes: TaskNotesPluginLike,
    status: string,
    project: string | null,
    column: HTMLElement
  ): void {
    if (!taskNotes.openTaskCreationModal) {
      new Notice("TaskNotes create dialog is unavailable.");
      return;
    }

    const baseFile = this.baseFileForElement(column);
    this.openTaskModalWithKanbanDefaults(taskNotes, status, project, baseFile).catch((error) => {
      console.error("Failed to open kanban task modal with defaults:", error);
      new Notice("Failed to read kanban defaults.");
      const fallbackContext = project
        ? this.contextFromWikiLink(project)
        : contextFromPathRoot(baseFile?.path);
      const defaults = buildKanbanTaskDefaults({
        status,
        priority: taskNotes.settings?.defaultTaskPriority ?? "normal",
        title: "",
        context: fallbackContext,
        project,
        epic: null,
      });
      this.patchCreateTaskForKanbanDefaults(taskNotes, defaults);
      taskNotes.openTaskCreationModal?.(defaults);
    });
  }

  private async openTaskModalWithKanbanDefaults(
    taskNotes: TaskNotesPluginLike,
    status: string,
    project: string | null,
    baseFile: TFile | null
  ): Promise<void> {
    const epic = await this.epicChoiceFromBaseFile(baseFile);
    const context =
      (project ? this.contextFromWikiLink(project) : null) ??
      contextFromPathRoot(epic?.path) ??
      contextFromPathRoot(baseFile?.path);
    const defaults = buildKanbanTaskDefaults({
      status,
      priority: taskNotes.settings?.defaultTaskPriority ?? "normal",
      title: "",
      context,
      project,
      epic: epic?.link ?? null,
    });
    this.patchCreateTaskForKanbanDefaults(taskNotes, defaults);
    taskNotes.openTaskCreationModal?.(defaults);
  }

  private normalizeSwimlaneProject(value: string | undefined): string | null {
    return normalizeSwimlaneProjectValue(value);
  }

  private contextFromWikiLink(value: string): string | null {
    return contextFromWikiLinkValue(value);
  }

  private addTaskButtonLabel(status: string, project: string | null): string {
    const target = project ? ` in ${this.displayNameForWikiLink(project)}` : "";
    return `Create ${status} task${target}`;
  }

  private displayNameForWikiLink(value: string): string {
    const match = value.match(/^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/);
    if (!match) {
      return value;
    }
    return match[2] ?? match[1].split("/").pop() ?? value;
  }

  private epicChoices(): EpicChoice[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.includes("/_obsidian/epics/"))
      .map((file) => ({
        label: file.basename,
        path: file.path,
        link: this.epicLink(file),
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  private epicLink(file: TFile): string {
    return `[[${file.path.replace(/\.md$/i, "")}|${file.basename}]]`;
  }

  private baseFileForElement(element: HTMLElement): TFile | null {
    const workspace = this.app.workspace as unknown as {
      iterateAllLeaves?: (callback: (leaf: unknown) => void) => void;
    };
    const leaves: Array<{ view?: { containerEl?: HTMLElement; file?: TFile } }> = [];
    workspace.iterateAllLeaves?.((leaf) => {
      leaves.push(leaf as { view?: { containerEl?: HTMLElement; file?: TFile } });
    });

    const matchingFile = leaves.find((leaf) => {
      return leaf.view?.containerEl?.contains(element) && leaf.view.file instanceof TFile;
    })?.view?.file;
    if (matchingFile?.path.endsWith(".base")) {
      return matchingFile;
    }

    const activeFile = this.app.workspace.getActiveFile();
    return activeFile?.path.endsWith(".base") ? activeFile : null;
  }

  private async epicChoiceFromBaseFile(file: TFile | null): Promise<EpicChoice | null> {
    if (!file) {
      return null;
    }
    const text = await this.app.vault.cachedRead(file);
    const epicPath = parseEpicPathFromBaseText(text);
    return epicPath ? this.epicChoiceFromPath(epicPath) : null;
  }

  private epicChoiceFromPath(path: string): EpicChoice {
    const markdownPath = path.endsWith(".md") ? path : `${path}.md`;
    const existing = this.app.vault.getAbstractFileByPath(markdownPath);
    if (existing instanceof TFile) {
      return {
        label: existing.basename,
        path: existing.path,
        link: this.epicLink(existing),
      };
    }

    const linkPath = path.replace(/\.md$/i, "");
    const label = linkPath.split("/").pop() ?? linkPath;
    return {
      label,
      path: markdownPath,
      link: `[[${linkPath}|${label}]]`,
    };
  }

  private patchCreateTaskForKanbanDefaults(
    taskNotes: TaskNotesPluginLike,
    defaults: Partial<TaskInfoLike>
  ): void {
    const service = taskNotes.taskService;
    const originalCreate = service?.createTask;
    if (!service || !originalCreate) {
      return;
    }

    this.restoreKanbanCreateTask?.();
    let restored = false;
    const timeout = window.setTimeout(() => restore(), 30 * 60 * 1000);
    const restore = (): void => {
      if (restored) {
        return;
      }
      window.clearTimeout(timeout);
      service.createTask = originalCreate;
      restored = true;
      if (this.restoreKanbanCreateTask === restore) {
        this.restoreKanbanCreateTask = null;
      }
    };

    service.createTask = async (taskData, options) => {
      try {
        return await originalCreate.call(service, mergeKanbanTaskDefaults(taskData, defaults), options);
      } finally {
        restore();
      }
    };

    this.restoreKanbanCreateTask = restore;
  }

  private enhanceEpicField(modal: HTMLElement, epics: EpicChoice[]): void {
    const setting = Array.from(modal.querySelectorAll(".setting-item")).find((item) => {
      const label = item.querySelector(".setting-item-name")?.textContent?.trim();
      return label === "Epic";
    });
    if (!(setting instanceof HTMLElement) || setting.querySelector(".omp-epic-picker")) {
      return;
    }

    const input = setting.querySelector("input[type='text'], textarea");
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) {
      return;
    }

    const listId = `omp-epics-${Math.random().toString(36).slice(2)}`;
    const dataList = document.createElement("datalist");
    dataList.id = listId;
    for (const epic of epics) {
      const option = document.createElement("option");
      option.value = epic.link;
      option.label = epic.label;
      dataList.appendChild(option);
    }
    setting.appendChild(dataList);
    input.setAttribute("list", listId);

    const picker = document.createElement("select");
    picker.addClass("dropdown", "omp-epic-picker");
    picker.createEl("option", { text: "Choose epic...", value: "" });
    for (const epic of epics) {
      picker.createEl("option", { text: epic.label, value: epic.link });
    }
    const current = input.value.trim();
    const currentChoice = epics.find((epic) => current === epic.link || current.includes(epic.path));
    if (currentChoice) {
      picker.value = currentChoice.link;
    }
    picker.addEventListener("change", () => {
      if (!picker.value) {
        return;
      }
      this.setInputValue(input, picker.value);
    });

    const control = setting.querySelector(".setting-item-control");
    if (control instanceof HTMLElement) {
      control.appendChild(picker);
    } else {
      setting.appendChild(picker);
    }
  }

  private setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
