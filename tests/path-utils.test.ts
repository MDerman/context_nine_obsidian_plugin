import { describe, expect, it } from "vitest";
import {
  attachmentFolderForRoot,
  firstNonEmptyLine,
  isTaskFilePath,
  slugifyTaskTitle,
  taskDestinationPathForContext,
  topRoot,
} from "../src/path-utils";

describe("path utilities", () => {
  it("detects known top roots", () => {
    expect(topRoot("03-impression/_obsidian/tasks/Foo.md", ["03-impression"])).toBe(
      "03-impression"
    );
    expect(topRoot("unknown/Foo.md", ["03-impression"])).toBeNull();
  });

  it("builds flat attachment folder paths", () => {
    expect(attachmentFolderForRoot("03-impression")).toBe("03-impression/_obsidian/attachments");
  });

  it("derives clean task titles", () => {
    expect(firstNonEmptyLine("\n# Ship this\nmore")).toBe("Ship this");
    expect(slugifyTaskTitle("bad/name: ok?")).toBe("bad-name- ok-");
  });

  it("detects and routes TaskNotes task files", () => {
    const roots = ["01-personal", "03-impression"];
    expect(isTaskFilePath("01-personal/_obsidian/tasks/Foo.md", roots)).toBe(true);
    expect(isTaskFilePath("01-personal/Matt/Foo.md", roots)).toBe(false);
    expect(taskDestinationPathForContext("01-personal/_obsidian/tasks/Foo.md", "03-impression")).toBe(
      "03-impression/_obsidian/tasks/Foo.md"
    );
  });
});
