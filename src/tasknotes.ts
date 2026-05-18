import type { App, TFile } from "obsidian";
import type { TaskInfoLike, TaskNotesPluginLike } from "./types";

export function getTaskNotesPlugin(app: App): TaskNotesPluginLike | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins
    ?.plugins;
  const taskNotes = plugins?.tasknotes;
  return taskNotes ? (taskNotes as TaskNotesPluginLike) : null;
}

export async function getTaskNotesTasks(app: App): Promise<TaskInfoLike[]> {
  const taskNotes = getTaskNotesPlugin(app);
  if (!taskNotes?.cacheManager?.getAllTasks) {
    return [];
  }
  const tasks = await taskNotes.cacheManager.getAllTasks();
  return tasks.filter((task) => !task.archived && task.path);
}

export function getTaskNotesField(taskNotes: TaskNotesPluginLike | null, field: string): string {
  return taskNotes?.fieldMapper?.toUserField?.(field) ?? taskNotes?.settings?.fieldMapping?.[field] ?? field;
}

export function notifyTaskNotesChanged(taskNotes: TaskNotesPluginLike | null, file: TFile): void {
  taskNotes?.cacheManager?.clearCacheEntry?.(file.path);
  taskNotes?.notifyDataChanged?.(file.path, false, true);
}

export function taskStatuses(taskNotes: TaskNotesPluginLike | null): Array<{ value: string; label: string }> {
  const statuses = taskNotes?.settings?.customStatuses ?? [];
  if (statuses.length > 0) {
    return statuses.map((status) => ({
      value: status.value,
      label: status.label ?? status.value,
    }));
  }
  return [
    { value: "backlog", label: "Backlog" },
    { value: "up-next", label: "Up next" },
    { value: "to-be-resumed", label: "To be resumed" },
    { value: "ongoing", label: "Ongoing" },
    { value: "in-progress", label: "In progress" },
    { value: "done", label: "Done" },
    { value: "archived", label: "Archived" },
  ];
}

export function taskPriorities(taskNotes: TaskNotesPluginLike | null): Array<{ value: string; label: string }> {
  const priorities = taskNotes?.settings?.customPriorities ?? [];
  if (priorities.length > 0) {
    return priorities.map((priority) => ({
      value: priority.value,
      label: priority.label ?? priority.value,
    }));
  }
  return [
    { value: "none", label: "None" },
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
  ];
}

