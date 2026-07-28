import { describe, expect, it } from "vitest";
import {
  activePeriodsForDate,
  isPastPeriod,
  localDateId,
  parsePeriodicNotePath,
  parseRefreshCompletionPayload,
  rolloverTargetPath,
} from "../src/periodic-tab-rollover";

const periods = {
  daily: "2026-07-28",
  weekly: "2026-W31",
  monthly: "2026-07",
  quarterly: "2026-Q3",
  yearly: "2026",
} as const;

describe("periodic tab rollover", () => {
  it("computes local period IDs including ISO week years", () => {
    const date = new Date(2021, 0, 1, 12);
    expect(localDateId(date)).toBe("2021-01-01");
    expect(activePeriodsForDate(date)).toEqual({
      daily: "2021-01-01",
      weekly: "2020-W53",
      monthly: "2021-01",
      quarterly: "2021-Q1",
      yearly: "2021",
    });
  });

  it("targets the current note in the same scope and period", () => {
    expect(rolloverTargetPath("personal/_obsidian/periodic/daily/2026-07-27.md", periods)).toBe(
      "personal/_obsidian/periodic/daily/2026-07-28.md"
    );
    expect(rolloverTargetPath("_system/_obsidian/periodic/weekly/2026-W30.md", periods)).toBe(
      "_system/_obsidian/periodic/weekly/2026-W31.md"
    );
  });

  it("leaves current and future periodic notes alone", () => {
    expect(rolloverTargetPath("personal/_obsidian/periodic/daily/2026-07-28.md", periods)).toBeNull();
    expect(rolloverTargetPath("personal/_obsidian/periodic/daily/2026-07-29.md", periods)).toBeNull();
    expect(rolloverTargetPath("personal/_obsidian/periodic/yearly/2027.md", periods)).toBeNull();
  });

  it("rejects unrelated and malformed paths and period IDs", () => {
    expect(parsePeriodicNotePath("personal/_obsidian/tasks/2026-07-27.md")).toBeNull();
    expect(rolloverTargetPath("nested/personal/_obsidian/periodic/daily/2026-07-27.md", periods)).toBeNull();
    expect(rolloverTargetPath("personal/_obsidian/periodic/daily/2026-02-30.md", periods)).toBeNull();
    expect(isPastPeriod("weekly", "2026-W54", "2027-W01")).toBe(false);
    expect(isPastPeriod("monthly", "2026-13", "2027-01")).toBe(false);
  });

  it("compares every period kind across boundaries", () => {
    expect(isPastPeriod("daily", "2025-12-31", "2026-01-01")).toBe(true);
    expect(isPastPeriod("weekly", "2025-W52", "2026-W01")).toBe(true);
    expect(isPastPeriod("monthly", "2025-12", "2026-01")).toBe(true);
    expect(isPastPeriod("quarterly", "2025-Q4", "2026-Q1")).toBe(true);
    expect(isPastPeriod("yearly", "2025", "2026")).toBe(true);
  });

  it("validates refresh completion payloads", () => {
    const payload = {
      schemaVersion: 1,
      runId: "2026-07-28T06:00:00Z-123",
      completedAt: "2026-07-28T08:00:00+02:00",
      effectiveDate: "2026-07-28",
      periods,
    };
    expect(parseRefreshCompletionPayload(payload)).toEqual(payload);
    expect(parseRefreshCompletionPayload({ ...payload, schemaVersion: 2 })).toBeNull();
    expect(parseRefreshCompletionPayload({ ...payload, periods: { ...periods, weekly: "2026-W99" } })).toBeNull();
  });
});
