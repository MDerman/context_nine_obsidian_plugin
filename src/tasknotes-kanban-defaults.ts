import type { TaskInfoLike } from "./types";

export interface KanbanTaskDefaultsInput {
  status: string;
  priority: string;
  title: string;
  context: string | null;
  project: string | null;
  epic: string | null;
}

export function normalizeSwimlaneProjectValue(value: string | undefined): string | null {
  const project = value?.trim();
  if (
    !project ||
    project === "undefined" ||
    project === "null" ||
    project === "None" ||
    project === "No project" ||
    project === "No projects"
  ) {
    return null;
  }
  return project;
}

export function parseEpicPathFromBaseText(text: string): string | null {
  const match = text.match(/\bepic\s*==\s*link\("([^"]+)"\)/);
  return match?.[1]?.trim() || null;
}

export function parseContextFromBaseText(text: string): string | null {
  const folderMatches = [
    ...text.matchAll(/\bfile\.inFolder\("(\d\d-[^"/]+)\/_obsidian\/(?:tasks|projects|epics)(?:\/[^"]*)?"\)/g),
  ];
  if (folderMatches.length === 1) {
    return folderMatches[0][1];
  }

  const contextMatches = [
    ...text.matchAll(/\bcontexts?\s*(?:==|\.contains\()\s*"?(\d\d-[^")\]]+)"?/g),
  ];
  if (contextMatches.length === 1) {
    return contextMatches[0][1].trim();
  }

  return null;
}

export function contextFromPathRoot(path: string | null | undefined): string | null {
  const root = path?.split("/")[0]?.trim();
  return root && /^\d\d-/.test(root) ? root : null;
}

export function contextFromWikiLinkValue(value: string): string | null {
  const match = value.match(/^\[\[([^|\]#]+)/);
  const path = match?.[1] ?? value;
  return contextFromPathRoot(path);
}

export function buildKanbanTaskDefaults(input: KanbanTaskDefaultsInput): Partial<TaskInfoLike> {
  const defaults: Partial<TaskInfoLike> = {
    status: input.status,
    priority: input.priority,
    title: input.title,
  };
  if (input.context) {
    defaults.contexts = [input.context];
  }
  if (input.project) {
    defaults.projects = [input.project];
  }
  if (input.epic) {
    defaults.customFrontmatter = { epic: input.epic };
  }
  return defaults;
}

export function mergeKanbanTaskDefaults(
  taskData: Record<string, unknown>,
  defaults: Partial<TaskInfoLike>
): Record<string, unknown> {
  const merged = { ...taskData };
  for (const key of ["status", "priority", "contexts", "projects"] as const) {
    if (!hasUsefulValue(merged[key]) && hasUsefulValue(defaults[key])) {
      merged[key] = cloneDefaultValue(defaults[key]);
    }
  }

  const defaultFrontmatter = recordFromUnknown(defaults.customFrontmatter);
  if (Object.keys(defaultFrontmatter).length > 0) {
    const customFrontmatter = { ...recordFromUnknown(merged.customFrontmatter) };
    for (const [key, value] of Object.entries(defaultFrontmatter)) {
      if (!hasUsefulValue(customFrontmatter[key])) {
        customFrontmatter[key] = value;
      }
    }
    merged.customFrontmatter = customFrontmatter;
  }

  return merged;
}

function hasUsefulValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== undefined && value !== null;
}

function cloneDefaultValue<T>(value: T): T {
  return Array.isArray(value) ? ([...value] as T) : value;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
