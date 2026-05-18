import { App, Modal, Setting, SuggestModal } from "obsidian";
import type { CapturedSelection, TaskInfoLike, TaskNotesPluginLike } from "./types";
import { firstNonEmptyLine } from "./path-utils";
import { taskPriorities, taskStatuses } from "./tasknotes";

export class TaskPickerModal extends SuggestModal<TaskInfoLike> {
  constructor(
    app: App,
    private readonly tasks: TaskInfoLike[],
    private readonly onPick: (task: TaskInfoLike) => void
  ) {
    super(app);
    this.setPlaceholder("Find a TaskNotes task...");
  }

  getSuggestions(query: string): TaskInfoLike[] {
    const normalized = query.toLowerCase();
    return this.tasks
      .filter((task) => {
        const haystack = `${task.title ?? ""} ${task.path} ${(task.contexts ?? []).join(" ")}`.toLowerCase();
        return haystack.includes(normalized);
      })
      .slice(0, 50);
  }

  renderSuggestion(task: TaskInfoLike, el: HTMLElement): void {
    el.createDiv({ text: task.title ?? task.path });
    el.createEl("small", { text: task.path });
  }

  onChooseSuggestion(task: TaskInfoLike): void {
    this.onPick(task);
  }
}

export interface AppendOptions {
  priority?: string;
  status?: string;
}

export class AppendOptionsModal extends Modal {
  private priority = "";
  private status = "";

  constructor(
    app: App,
    private readonly taskNotes: TaskNotesPluginLike | null,
    private readonly task: TaskInfoLike,
    private readonly onSubmit: (options: AppendOptions) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.containerEl.addClass("omp-modal");
    this.titleEl.setText("Append capture");

    this.contentEl.createEl("p", {
      text: this.task.title ?? this.task.path,
    });

    new Setting(this.contentEl).setName("Priority").addDropdown((dropdown) => {
      dropdown.addOption("", "Keep current");
      for (const priority of taskPriorities(this.taskNotes)) {
        dropdown.addOption(priority.value, priority.label);
      }
      dropdown.onChange((value) => {
        this.priority = value;
      });
    });

    new Setting(this.contentEl).setName("Status").addDropdown((dropdown) => {
      dropdown.addOption("", "Keep current");
      for (const status of taskStatuses(this.taskNotes)) {
        dropdown.addOption(status.value, status.label);
      }
      dropdown.onChange((value) => {
        this.status = value;
      });
    });

    const buttons = this.contentEl.createDiv({ cls: "omp-button-row" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const append = buttons.createEl("button", { text: "Append" });
    append.addClass("mod-cta");
    append.addEventListener("click", () => {
      this.close();
      this.onSubmit({
        priority: this.priority || undefined,
        status: this.status || undefined,
      });
    });
  }
}

export interface FallbackTaskData {
  title: string;
  context: string;
  status: string;
  priority: string;
}

export class FallbackCreateTaskModal extends Modal {
  private title: string;
  private context: string;
  private status: string;
  private priority: string;

  constructor(
    app: App,
    private readonly captured: CapturedSelection,
    private readonly taskNotes: TaskNotesPluginLike | null,
    private readonly knownContexts: string[],
    defaultContext: string,
    private readonly onSubmit: (data: FallbackTaskData) => void
  ) {
    super(app);
    this.title = firstNonEmptyLine(captured.text);
    this.context = defaultContext;
    this.status = taskNotes?.settings?.defaultTaskStatus ?? "backlog";
    this.priority = taskNotes?.settings?.defaultTaskPriority ?? "normal";
  }

  onOpen(): void {
    this.contentEl.empty();
    this.containerEl.addClass("omp-modal");
    this.titleEl.setText("New captured task");

    new Setting(this.contentEl).setName("Title").addText((text) => {
      text.setValue(this.title).onChange((value) => {
        this.title = value;
      });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(this.contentEl).setName("Context").addDropdown((dropdown) => {
      for (const context of this.knownContexts) {
        dropdown.addOption(context, context);
      }
      dropdown.setValue(this.context).onChange((value) => {
        this.context = value;
      });
    });

    new Setting(this.contentEl).setName("Priority").addDropdown((dropdown) => {
      for (const priority of taskPriorities(this.taskNotes)) {
        dropdown.addOption(priority.value, priority.label);
      }
      dropdown.setValue(this.priority).onChange((value) => {
        this.priority = value;
      });
    });

    new Setting(this.contentEl).setName("Status").addDropdown((dropdown) => {
      for (const status of taskStatuses(this.taskNotes)) {
        dropdown.addOption(status.value, status.label);
      }
      dropdown.setValue(this.status).onChange((value) => {
        this.status = value;
      });
    });

    this.contentEl.createEl("div", {
      cls: "omp-selection-preview",
      text: this.captured.text,
    });

    const buttons = this.contentEl.createDiv({ cls: "omp-button-row" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    const create = buttons.createEl("button", { text: "Create task" });
    create.addClass("mod-cta");
    create.addEventListener("click", () => this.submit());
  }

  private submit(): void {
    if (!this.title.trim()) {
      this.title = firstNonEmptyLine(this.captured.text);
    }
    this.close();
    this.onSubmit({
      title: this.title.trim(),
      context: this.context,
      status: this.status,
      priority: this.priority,
    });
  }
}
