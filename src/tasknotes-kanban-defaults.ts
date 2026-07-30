import type { TaskInfoLike } from "./types";

export interface KanbanTaskDefaultsInput {
  status: string;
  priority: string;
  title: string;
  context: string | null;
  project: string | null;
  epic: string | null;
}

export interface KanbanViewScope {
  context: string | null;
  epicPath: string | null;
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
  const matches = [...text.matchAll(/\bepic\s*==\s*link\("([^"]+)"\)/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  return uniqueValue(matches);
}

export function parseContextFromBaseText(
  text: string,
  knownRoots?: readonly string[]
): string | null {
  const folderMatches = [
    ...text.matchAll(/\bfile\.inFolder\("([^"/]+)\/_obsidian\/(?:tasks|projects|epics)(?:\/[^"]*)?"\)/g),
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value) && isKnownRoot(value, knownRoots));

  const contextMatches = [
    ...text.matchAll(/\bcontexts?\s*(?:==|\.contains\()\s*"?([^")\],]+)"?/g),
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value) && isKnownRoot(value, knownRoots));

  return uniqueValue([...folderMatches, ...contextMatches]);
}

export function resolveKanbanViewScope(
  definition: unknown,
  activeViewName: string | null,
  knownRoots: readonly string[]
): KanbanViewScope {
  const base = recordFromUnknown(definition);
  const views = Array.isArray(base.views) ? base.views : [];
  const activeView = views
    .map(recordFromUnknown)
    .find((view) => typeof view.name === "string" && view.name === activeViewName);
  const filterText = stringsFromUnknown([base.filters, activeView?.filters]).join("\n");
  return {
    context: parseContextFromBaseText(filterText, knownRoots),
    epicPath: parseEpicPathFromBaseText(filterText),
  };
}

export function contextFromPathRoot(
  path: string | null | undefined,
  knownRoots?: readonly string[]
): string | null {
  const root = path?.split("/")[0]?.trim();
  return root && isKnownRoot(root, knownRoots) ? root : null;
}

export function contextFromWikiLinkValue(
  value: string,
  knownRoots?: readonly string[]
): string | null {
  const match = value.match(/^\[\[([^|\]#]+)/);
  const path = match?.[1] ?? value;
  return contextFromPathRoot(path, knownRoots);
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

function stringsFromUnknown(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsFromUnknown);
  }
  const record = recordFromUnknown(value);
  return Object.values(record).flatMap(stringsFromUnknown);
}

function isKnownRoot(value: string, knownRoots?: readonly string[]): boolean {
  if (!value || value.startsWith("_")) {
    return false;
  }
  return knownRoots ? knownRoots.includes(value) : true;
}

function uniqueValue(values: string[]): string | null {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}
