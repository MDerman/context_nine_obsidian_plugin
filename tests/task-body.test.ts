import { describe, expect, it } from "vitest";
import { appendCapture, joinFrontmatter, splitFrontmatter } from "../src/task-body";

describe("task body helpers", () => {
  it("preserves frontmatter while appending captures", () => {
    const split = splitFrontmatter("---\ntitle: Test\n---\n\nExisting body\n");
    const body = appendCapture(split.body, "Captured content", "[[Source]]", new Date(2026, 4, 14, 10, 30));
    const joined = joinFrontmatter(split.frontmatter, body);

    expect(joined).toContain("---\ntitle: Test\n---");
    expect(joined).toContain("## Captures");
    expect(joined).toContain("### 2026-05-14 10:30 from [[Source]]");
    expect(joined).toContain("Captured content");
  });

  it("reuses an existing captures section", () => {
    const body = appendCapture("Intro\n\n## Captures\n\nOld", "New", "[[Source]]", new Date(2026, 4, 14, 0, 0));
    expect(body.match(/## Captures/g)).toHaveLength(1);
    expect(body).toContain("Old\n\n###");
  });
});
