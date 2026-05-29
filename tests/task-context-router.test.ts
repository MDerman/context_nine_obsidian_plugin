import { describe, expect, it } from "vitest";
import { firstContextValue, taskContextFromFrontmatter } from "../src/task-context";

describe("task context router", () => {
  it("reads first context from TaskNotes frontmatter arrays", () => {
    expect(firstContextValue(["03-impression", "02-matt-derman"])).toBe("03-impression");
  });

  it("reads first context from comma-delimited strings", () => {
    expect(firstContextValue("03-impression, 02-matt-derman")).toBe("03-impression");
  });

  it("uses mapped TaskNotes context field", () => {
    expect(
      taskContextFromFrontmatter(
        { taskContexts: ["02-matt-derman"] },
        { fieldMapper: { toUserField: (field) => (field === "contexts" ? "taskContexts" : field) } }
      )
    ).toBe("02-matt-derman");
  });
});
