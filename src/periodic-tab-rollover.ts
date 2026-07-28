export const REFRESH_COMPLETION_MARKER_PATH = "_system/state/refresh-complete.json";

export const PERIOD_KINDS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

export type PeriodKind = (typeof PERIOD_KINDS)[number];

export type ActivePeriods = Record<PeriodKind, string>;

export interface RefreshCompletionPayload {
  schemaVersion: 1;
  runId: string;
  completedAt: string;
  effectiveDate: string;
  periods: ActivePeriods;
}

export interface PeriodicNotePath {
  scope: string;
  kind: PeriodKind;
  id: string;
}

const PERIODIC_NOTE_PATH_RE = /^(?<scope>[^/]+)\/_obsidian\/periodic\/(?<kind>daily|weekly|monthly|quarterly|yearly)\/(?<id>[^/]+)\.md$/;

export function localDateId(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function activePeriodsForDate(date: Date): ActivePeriods {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const quarter = Math.floor((month - 1) / 3) + 1;
  const iso = isoWeek(date);
  return {
    daily: localDateId(date),
    weekly: `${iso.year}-W${String(iso.week).padStart(2, "0")}`,
    monthly: `${year}-${String(month).padStart(2, "0")}`,
    quarterly: `${year}-Q${quarter}`,
    yearly: String(year),
  };
}

export function parsePeriodicNotePath(path: string): PeriodicNotePath | null {
  const match = PERIODIC_NOTE_PATH_RE.exec(path);
  if (!match?.groups) {
    return null;
  }
  return {
    scope: match.groups.scope,
    kind: match.groups.kind as PeriodKind,
    id: match.groups.id,
  };
}

export function rolloverTargetPath(path: string, activePeriods: ActivePeriods): string | null {
  const note = parsePeriodicNotePath(path);
  if (!note || !isPastPeriod(note.kind, note.id, activePeriods[note.kind])) {
    return null;
  }
  return `${note.scope}/_obsidian/periodic/${note.kind}/${activePeriods[note.kind]}.md`;
}

export function isPastPeriod(kind: PeriodKind, candidateId: string, currentId: string): boolean {
  const candidate = periodSortKey(kind, candidateId);
  const current = periodSortKey(kind, currentId);
  if (!candidate || !current) {
    return false;
  }
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== current[index]) {
      return candidate[index] < current[index];
    }
  }
  return false;
}

export function parseRefreshCompletionPayload(value: unknown): RefreshCompletionPayload | null {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return null;
  }
  if (
    typeof value.runId !== "string" ||
    !value.runId ||
    typeof value.completedAt !== "string" ||
    typeof value.effectiveDate !== "string" ||
    !isRecord(value.periods)
  ) {
    return null;
  }
  const periods = value.periods;
  for (const kind of PERIOD_KINDS) {
    if (typeof periods[kind] !== "string" || !periodSortKey(kind, periods[kind])) {
      return null;
    }
  }
  if (!periodSortKey("daily", value.effectiveDate)) {
    return null;
  }
  return value as unknown as RefreshCompletionPayload;
}

function isoWeek(date: Date): { year: number; week: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year, week };
}

function periodSortKey(kind: PeriodKind, value: string): number[] | null {
  if (kind === "daily") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() + 1 !== month ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return [year, month, day];
  }

  if (kind === "weekly") {
    const match = /^(\d{4})-W(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (week < 1 || week > isoWeeksInYear(year)) {
      return null;
    }
    return [year, week];
  }

  if (kind === "monthly") {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? [year, month] : null;
  }

  if (kind === "quarterly") {
    const match = /^(\d{4})-Q([1-4])$/.exec(value);
    return match ? [Number(match[1]), Number(match[2])] : null;
  }

  const match = /^(\d{4})$/.exec(value);
  return match ? [Number(match[1])] : null;
}

function isoWeeksInYear(year: number): number {
  const december28 = new Date(Date.UTC(year, 11, 28));
  const yearStart = new Date(Date.UTC(year, 0, 1));
  return Math.ceil(((december28.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
