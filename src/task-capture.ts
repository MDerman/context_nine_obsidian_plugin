import { App, Editor, Notice, TFile, normalizePath } from "obsidian";
import { AttachmentRouter } from "./attachment-router";
import {
  AppendOptionsModal,
  FallbackCreateTaskModal,
  TaskPickerModal,
} from "./modals";
import { captureSelection, deleteSelectionIfUnchanged } from "./selection";
import { appendCapture, joinFrontmatter, splitFrontmatter } from "./task-body";
import {
  getTaskNotesField,
  getTaskNotesPlugin,
  getTaskNotesTasks,
  notifyTaskNotesChanged,
} from "./tasknotes";
import type {
  CapturedSelection,
  MasterPluginSettings,
  TaskInfoLike,
  TaskNotesPluginLike,
} from "./types";
import { firstNonEmptyLine, slugifyTaskTitle, taskFolderForContext, topRoot } from "./path-utils";

export class TaskCaptureService {
  private restoreTaskNotesCreate: (() => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly router: AttachmentRouter,
    private readonly getSettings: () => MasterPluginSettings,
    private readonly saveSettings: () => Promise<void>
  ) {}

  async captureSelectionToNewTask(editor: Editor): Promise<void> {
    const sourceFile = this.app.workspace.getActiveFile();
    if (!sourceFile) {
      new Notice("No active Markdown file.");
      return;
    }

    const captured = captureSelection(editor, sourceFile);
    if (!captured) {
      const taskNotes = getTaskNotesPlugin(this.app);
      if (!this.openTaskNotesCreateModal(taskNotes)) {
        new Notice("TaskNotes create dialog is unavailable.");
      }
      return;
    }

    await this.captureToNewTask(captured);
  }

  async appendSelectionToExistingTask(editor: Editor): Promise<void> {
    const sourceFile = this.app.workspace.getActiveFile();
    if (!sourceFile) {
      new Notice("No active Markdown file.");
      return;
    }

    const captured = captureSelection(editor, sourceFile);
    if (!captured) {
      new Notice("Select text or attachment links before appending.");
      return;
    }

    await this.captureToExistingTask(captured);
  }

  private async captureToNewTask(captured: CapturedSelection): Promise<void> {
    const taskNotes = getTaskNotesPlugin(this.app);
    if (this.openTaskNotesCreateModal(taskNotes, captured)) {
      return;
    }

    new FallbackCreateTaskModal(
      this.app,
      captured,
      taskNotes,
      this.getSettings().knownRoots.filter((root) => root.match(/^\d\d-/)),
      this.getPreferredContext(),
      (data) => {
        void this.createTaskFromFallbackModal(captured, data, taskNotes);
      }
    ).open();
  }

  private openTaskNotesCreateModal(
    taskNotes: TaskNotesPluginLike | null,
    captured?: CapturedSelection
  ): boolean {
    if (!taskNotes?.openTaskCreationModal) {
      return false;
    }

    const defaults: Partial<TaskInfoLike> = {
      contexts: [this.getPreferredContext()],
      priority: taskNotes.settings?.defaultTaskPriority ?? "normal",
      status: taskNotes.settings?.defaultTaskStatus ?? "backlog",
    };
    if (!captured || !taskNotes.settings?.enableNaturalLanguageInput) {
      defaults.title = captured ? firstNonEmptyLine(captured.text) : "";
    }

    if (!captured) {
      taskNotes.openTaskCreationModal(defaults);
      return true;
    }

    if (!taskNotes.taskService?.createTask) {
      return false;
    }

    this.restoreTaskNotesCreate?.();
    const service = taskNotes.taskService;
    const originalCreate = service.createTask;
    if (!originalCreate) {
      return false;
    }
    let restored = false;
    const restore = (): void => {
      if (restored) {
        return;
      }
      service.createTask = originalCreate;
      restored = true;
      if (this.restoreTaskNotesCreate === restore) {
        this.restoreTaskNotesCreate = null;
      }
    };
    this.restoreTaskNotesCreate = restore;

    const timeout = window.setTimeout(restore, 30 * 60 * 1000);
    service.createTask = async (taskData, options) => {
      try {
        const context = this.contextFromTaskData(taskData);
        await this.persistLastContext(context);

        const userDetails =
          typeof taskData.details === "string" && taskData.details.trim()
            ? taskData.details.trimEnd()
            : "";
        const combinedDetails = userDetails
          ? `${userDetails}\n\n${captured.text.trim()}`
          : captured.text.trim();
        const routed = await this.router.routeMarkdownAttachments(
          combinedDetails,
          captured.sourceFile,
          context
        );

        const result = await originalCreate.call(
          service,
          {
            ...taskData,
            details: routed.markdown,
          },
          options
        );
        this.deleteSourceAfterSuccess(captured);
        new Notice(`Created task "${result.taskInfo.title ?? "Captured selection"}".`);
        return result;
      } finally {
        window.clearTimeout(timeout);
        restore();
      }
    };

    taskNotes.openTaskCreationModal(defaults);
    return true;
  }

  private async captureToExistingTask(captured: CapturedSelection): Promise<void> {
    const tasks = await getTaskNotesTasks(this.app);
    if (tasks.length === 0) {
      new Notice("No TaskNotes tasks found.");
      return;
    }
    const taskNotes = getTaskNotesPlugin(this.app);
    new TaskPickerModal(this.app, tasks, (task) => {
      new AppendOptionsModal(this.app, taskNotes, task, (options) => {
        void this.appendToTask(captured, task, options);
      }).open();
    }).open();
  }

  private async createTaskFromFallbackModal(
    captured: CapturedSelection,
    data: { title: string; context: string; status: string; priority: string },
    taskNotes: TaskNotesPluginLike | null
  ): Promise<void> {
    await this.persistLastContext(data.context);
    const routed = await this.router.routeMarkdownAttachments(
      captured.text.trim(),
      captured.sourceFile,
      data.context
    );

    if (taskNotes?.taskService?.createTask) {
      const result = await taskNotes.taskService.createTask({
        title: data.title,
        contexts: [data.context],
        status: data.status,
        priority: data.priority,
        details: routed.markdown,
      });
      this.deleteSourceAfterSuccess(captured);
      new Notice(`Created task "${result.taskInfo.title ?? data.title}".`);
      return;
    }

    const file = await this.createManualTaskFile(data, routed.markdown);
    this.deleteSourceAfterSuccess(captured);
    new Notice(`Created task "${file.basename}".`);
  }

  private async appendToTask(
    captured: CapturedSelection,
    task: TaskInfoLike,
    options: { priority?: string; status?: string }
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice(`Task file not found: ${task.path}`);
      return;
    }

    const targetRoot = this.rootForTask(task);
    await this.persistLastContext(targetRoot);
    const routed = await this.router.routeMarkdownAttachments(
      captured.text.trim(),
      captured.sourceFile,
      targetRoot,
      file.path
    );

    const sourceLink = this.sourceLinkForTask(captured.sourceFile, file);
    const current = await this.app.vault.read(file);
    const split = splitFrontmatter(current);
    const updatedBody = appendCapture(split.body, routed.markdown, sourceLink, new Date());
    await this.app.vault.modify(file, joinFrontmatter(split.frontmatter, updatedBody));

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const taskNotes = getTaskNotesPlugin(this.app);
      frontmatter[getTaskNotesField(taskNotes, "dateModified")] = new Date().toISOString();
      if (options.priority) {
        frontmatter[getTaskNotesField(taskNotes, "priority")] = options.priority;
      }
      if (options.status) {
        frontmatter[getTaskNotesField(taskNotes, "status")] = options.status;
      }
    });

    notifyTaskNotesChanged(getTaskNotesPlugin(this.app), file);
    this.deleteSourceAfterSuccess(captured);
    new Notice(`Appended capture to "${task.title ?? file.basename}".`);
  }

  private async createManualTaskFile(
    data: { title: string; context: string; status: string; priority: string },
    details: string
  ): Promise<TFile> {
    const folder = taskFolderForContext(data.context);
    await this.ensureFolder(folder);
    const path = await this.uniqueTaskPath(folder, data.title);
    const now = new Date().toISOString();
    const content = `---\ntitle: ${JSON.stringify(data.title)}\nstatus: ${JSON.stringify(
      data.status
    )}\npriority: ${JSON.stringify(data.priority)}\ncontexts:\n  - ${JSON.stringify(
      data.context
    )}\ntags:\n  - task\ndateCreated: ${JSON.stringify(now)}\ndateModified: ${JSON.stringify(
      now
    )}\n---\n\n${details.trimEnd()}\n`;
    return this.app.vault.create(path, content);
  }

  private async uniqueTaskPath(folder: string, title: string): Promise<string> {
    const stem = slugifyTaskTitle(title);
    for (let index = 0; index < 500; index += 1) {
      const suffix = index === 0 ? "" : ` (${index + 1})`;
      const path = normalizePath(`${folder}/${stem}${suffix}.md`);
      if (!(await this.app.vault.adapter.exists(path))) {
        return path;
      }
    }
    throw new Error(`Could not find a free task filename for ${title}`);
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const parts = normalizePath(folderPath).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private contextFromTaskData(taskData: Record<string, unknown>): string {
    const contexts = taskData.contexts;
    if (Array.isArray(contexts) && typeof contexts[0] === "string" && contexts[0]) {
      return contexts[0];
    }
    if (typeof contexts === "string" && contexts) {
      return contexts.split(",")[0]?.trim() || this.getPreferredContext();
    }
    return this.getPreferredContext();
  }

  private rootForTask(task: TaskInfoLike): string {
    const fromPath = topRoot(task.path, this.getSettings().knownRoots);
    if (fromPath) {
      return fromPath;
    }
    const context = task.contexts?.[0];
    if (context && this.getSettings().knownRoots.includes(context)) {
      return context;
    }
    return this.getPreferredContext();
  }

  private sourceLinkForTask(sourceFile: TFile, taskFile: TFile): string {
    try {
      return this.app.fileManager.generateMarkdownLink(sourceFile, taskFile.path, "", sourceFile.basename);
    } catch {
      return `[[${sourceFile.path}|${sourceFile.basename}]]`;
    }
  }

  private getPreferredContext(): string {
    const settings = this.getSettings();
    return settings.lastContext || settings.defaultContext;
  }

  private async persistLastContext(context: string): Promise<void> {
    const settings = this.getSettings();
    settings.lastContext = context;
    await this.saveSettings();
  }

  private deleteSourceAfterSuccess(captured: CapturedSelection): void {
    if (!this.getSettings().deleteSourceAfterCapture) {
      return;
    }
    const deleted = deleteSelectionIfUnchanged(captured);
    if (!deleted) {
      new Notice("Task created, but the original selection changed before it could be deleted.");
    }
  }
}
