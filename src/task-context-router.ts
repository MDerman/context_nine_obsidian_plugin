import { App, Component, Notice, TFile, normalizePath, type CachedMetadata } from "obsidian";
import { basename, isTaskFilePath, taskDestinationPathForContext } from "./path-utils";
import { taskContextFromFrontmatter } from "./task-context";
import { getTaskNotesPlugin } from "./tasknotes";
import type { MasterPluginSettings, TaskNotesPluginLike } from "./types";

export class TaskContextRouterService {
  private readonly queuedPaths = new Set<string>();
  private flushTimer: number | null = null;
  private moving = false;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => MasterPluginSettings
  ) {}

  register(plugin: Component): void {
    plugin.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        this.queueChangedFile(file, cache);
      })
    );
  }

  async routeAllTasks(): Promise<number> {
    const taskNotes = getTaskNotesPlugin(this.app);
    let moved = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (await this.routeTaskFile(file, taskNotes)) {
        moved += 1;
      }
    }
    return moved;
  }

  private queueChangedFile(file: TFile, cache: CachedMetadata): void {
    if (this.moving) {
      return;
    }
    const settings = this.getSettings();
    if (!isTaskFilePath(file.path, settings.knownRoots)) {
      return;
    }
    const taskNotes = getTaskNotesPlugin(this.app);
    const context = taskContextFromFrontmatter(cache.frontmatter, taskNotes);
    if (!this.shouldRoute(file.path, context)) {
      return;
    }
    this.queuedPaths.add(file.path);
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
    }
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flushQueue();
    }, 750);
  }

  private async flushQueue(): Promise<void> {
    const paths = [...this.queuedPaths];
    this.queuedPaths.clear();
    const taskNotes = getTaskNotesPlugin(this.app);
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.routeTaskFile(file, taskNotes);
      }
    }
  }

  private async routeTaskFile(file: TFile, taskNotes: TaskNotesPluginLike | null): Promise<boolean> {
    const settings = this.getSettings();
    if (!isTaskFilePath(file.path, settings.knownRoots)) {
      return false;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const context = taskContextFromFrontmatter(cache?.frontmatter, taskNotes);
    if (!this.shouldRoute(file.path, context)) {
      return false;
    }

    const targetPath = await this.uniqueTargetPath(taskDestinationPathForContext(file.path, context!));
    const oldPath = file.path;
    await this.ensureFolder(`${context}/_obsidian/tasks`);

    this.moving = true;
    try {
      await this.app.vault.rename(file, targetPath);
      taskNotes?.cacheManager?.clearCacheEntry?.(oldPath);
      taskNotes?.cacheManager?.clearCacheEntry?.(targetPath);
      taskNotes?.notifyDataChanged?.(targetPath, false, true);
      new Notice(`Moved task to ${targetPath}`);
      return true;
    } finally {
      this.moving = false;
    }
  }

  private shouldRoute(path: string, context: string | null): boolean {
    if (!context || !this.getSettings().knownRoots.includes(context)) {
      return false;
    }
    const targetPath = taskDestinationPathForContext(path, context);
    return normalizePath(path) !== normalizePath(targetPath);
  }

  private async uniqueTargetPath(path: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(path))) {
      return path;
    }
    const ext = ".md";
    const stem = path.endsWith(ext) ? path.slice(0, -ext.length) : path;
    for (let index = 2; index < 500; index += 1) {
      const candidate = `${stem} (${index})${ext}`;
      if (!(await this.app.vault.adapter.exists(candidate))) {
        return candidate;
      }
    }
    throw new Error(`Could not find a free task filename for ${basename(path)}`);
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
}
