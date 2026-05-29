import { getTaskNotesField } from "./tasknotes";
import type { TaskNotesPluginLike } from "./types";

export function firstContextValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
    }
    return null;
  }
  if (typeof value === "string") {
    const context = value.split(",")[0]?.trim();
    return context || null;
  }
  return null;
}

export function taskContextFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
  taskNotes: TaskNotesPluginLike | null
): string | null {
  if (!frontmatter) {
    return null;
  }
  const contextsField = getTaskNotesField(taskNotes, "contexts");
  return firstContextValue(frontmatter[contextsField] ?? frontmatter.contexts);
}
