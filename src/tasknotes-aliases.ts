export interface EpicChoiceLike {
  label: string;
  path: string;
  link: string;
}

const PRIORITY_ALIASES: Record<string, string> = {
  important: "high",
};

export function normalizeTaskAliases(
  taskData: Record<string, unknown>,
  epics: EpicChoiceLike[]
): Record<string, unknown> {
  const normalized = { ...taskData };
  if (typeof normalized.priority === "string") {
    normalized.priority = PRIORITY_ALIASES[normalized.priority] ?? normalized.priority;
  }

  if (typeof normalized.title === "string") {
    const priorityParsed = extractPriorityAlias(normalized.title, normalized.priority);
    const customFrontmatter = recordFromUnknown(normalized.customFrontmatter);
    const epicParsed = extractEpicAlias(
      priorityParsed.text,
      customFrontmatter.epic ?? normalized.epic,
      epics
    );
    normalized.title = epicParsed.text;
    normalized.priority = priorityParsed.priority;
    if (epicParsed.epic) {
      normalized.customFrontmatter = {
        ...customFrontmatter,
        epic: epicParsed.epic,
      };
    }
  }

  return normalized;
}

function extractPriorityAlias(
  text: string,
  currentPriority: unknown
): { text: string; priority: unknown } {
  let priority = currentPriority;
  const cleaned = text.replace(/(^|\s)!([a-z][\w-]*)\b/gi, (match, prefix, rawAlias) => {
    const alias = rawAlias.toLowerCase();
    const mapped = PRIORITY_ALIASES[alias];
    if (!mapped) {
      return match;
    }
    priority = mapped;
    return prefix;
  });
  return { text: cleaned.replace(/\s{2,}/g, " ").trim(), priority };
}

function extractEpicAlias(
  text: string,
  currentEpic: unknown,
  epics: EpicChoiceLike[]
): { text: string; epic: unknown } {
  let epic = currentEpic;
  const cleaned = text.replace(
    /(^|\s)\^(?:"([^"]+)"|'([^']+)'|([^\s]+))/g,
    (match, prefix, doubleQuoted, singleQuoted, bare) => {
      const rawAlias = (doubleQuoted ?? singleQuoted ?? bare)?.trim();
      if (!rawAlias) {
        return match;
      }

      const choice = findEpicChoice(rawAlias, epics);
      if (!choice) {
        return match;
      }

      epic = choice.link;
      return prefix;
    }
  );
  return { text: cleaned.replace(/\s{2,}/g, " ").trim(), epic };
}

function findEpicChoice(alias: string, epics: EpicChoiceLike[]): EpicChoiceLike | null {
  const normalizedAlias = normalizeEpicAlias(alias);
  if (!normalizedAlias) {
    return null;
  }

  return (
    epics.find((choice) => normalizeEpicAlias(choice.label) === normalizedAlias) ??
    epics.find((choice) => normalizeEpicAlias(choice.path) === normalizedAlias) ??
    null
  );
}

function normalizeEpicAlias(value: string): string {
  return value
    .replace(/\.md$/i, "")
    .split("/")
    .pop()!
    .trim()
    .toLowerCase();
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
