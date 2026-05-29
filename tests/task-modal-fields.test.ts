import { describe, expect, it } from "vitest";
import { entityLink, firstStringValue, linkLabel, vaultCreateArgs } from "../src/task-modal-fields";

describe("task modal field helpers", () => {
  it("formats entity links without markdown suffix", () => {
    expect(entityLink("03-impression/_obsidian/epics/Backlog.md", "Backlog")).toBe(
      "[[03-impression/_obsidian/epics/Backlog|Backlog]]"
    );
  });

  it("extracts display labels from links and arrays", () => {
    expect(linkLabel("[[03-impression/_obsidian/epics/Backlog|Backlog]]")).toBe("Backlog");
    expect(linkLabel("[[03-impression/_obsidian/projects/Main]]")).toBe("Main");
    expect(firstStringValue(["[[x|One]]", "[[x|Two]]"])).toBe("[[x|One]]");
  });

  it("builds vault create commands", () => {
    expect(vaultCreateArgs("epic", "03-impression", "Launch")).toEqual([
      "epic",
      "create",
      "03-impression",
      "Launch",
    ]);
    expect(vaultCreateArgs("project", "03-impression", "Launch copy", "Growth")).toEqual([
      "project",
      "create",
      "03-impression",
      "Launch copy",
      "--epic",
      "Growth",
    ]);
  });
});
