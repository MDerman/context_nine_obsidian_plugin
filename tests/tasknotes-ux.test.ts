import { describe, expect, it } from "vitest";
import { normalizeTaskAliases } from "../src/tasknotes-aliases";
import {
  buildKanbanTaskDefaults,
  mergeKanbanTaskDefaults,
  normalizeSwimlaneProjectValue,
  parseEpicPathFromBaseText,
} from "../src/tasknotes-kanban-defaults";

const epics = [
  {
    label: "Growth",
    path: "03-impression/_obsidian/epics/Growth.md",
    link: "[[03-impression/_obsidian/epics/Growth.md|Growth]]",
  },
  {
    label: "Backlog",
    path: "03-impression/_obsidian/epics/Backlog.md",
    link: "[[03-impression/_obsidian/epics/Backlog.md|Backlog]]",
  },
];

describe("TaskNotes UX aliases", () => {
  it("extracts caret epic aliases from task titles", () => {
    const task = normalizeTaskAliases({ title: "Ship better onboarding ^Growth" }, epics);

    expect(task.title).toBe("Ship better onboarding");
    expect(task.epic).toBeUndefined();
    expect(task.customFrontmatter).toEqual({
      epic: "[[03-impression/_obsidian/epics/Growth.md|Growth]]",
    });
  });

  it("keeps unknown caret aliases in the title", () => {
    const task = normalizeTaskAliases({ title: "Ship better onboarding ^Unknown" }, epics);

    expect(task.title).toBe("Ship better onboarding ^Unknown");
    expect(task.epic).toBeUndefined();
    expect(task.customFrontmatter).toBeUndefined();
  });

  it("treats empty project swimlanes as no project", () => {
    expect(normalizeSwimlaneProjectValue("None")).toBeNull();
    expect(normalizeSwimlaneProjectValue("No projects")).toBeNull();
    expect(normalizeSwimlaneProjectValue("null")).toBeNull();
    expect(normalizeSwimlaneProjectValue("[[03-impression/_obsidian/projects/Launch|Launch]]")).toBe(
      "[[03-impression/_obsidian/projects/Launch|Launch]]"
    );
  });

  it("parses epic filters from generated base files", () => {
    expect(
      parseEpicPathFromBaseText(`
filters:
  and:
    - file.hasTag("task")
    - 'epic == link("03-impression/_obsidian/epics/Focus")'
`)
    ).toBe("03-impression/_obsidian/epics/Focus");
  });

  it("merges kanban defaults into blank task data", () => {
    const defaults = buildKanbanTaskDefaults({
      status: "backlog",
      priority: "normal",
      title: "",
      context: "03-impression",
      project: null,
      epic: "[[03-impression/_obsidian/epics/Focus|Focus]]",
    });

    const task = mergeKanbanTaskDefaults({ title: "New task" }, defaults);

    expect(task).toMatchObject({
      title: "New task",
      status: "backlog",
      priority: "normal",
      contexts: ["03-impression"],
      customFrontmatter: {
        epic: "[[03-impression/_obsidian/epics/Focus|Focus]]",
      },
    });
    expect(task.projects).toBeUndefined();
  });

  it("adds project swimlane defaults", () => {
    const project = "[[03-impression/_obsidian/projects/Launch|Launch]]";
    const defaults = buildKanbanTaskDefaults({
      status: "up-next",
      priority: "normal",
      title: "",
      context: "03-impression",
      project,
      epic: "[[03-impression/_obsidian/epics/Growth|Growth]]",
    });

    const task = mergeKanbanTaskDefaults({ title: "New task" }, defaults);

    expect(task.projects).toEqual([project]);
    expect(task.contexts).toEqual(["03-impression"]);
  });

  it("keeps user-edited values over kanban defaults", () => {
    const defaults = buildKanbanTaskDefaults({
      status: "backlog",
      priority: "normal",
      title: "",
      context: "03-impression",
      project: "[[03-impression/_obsidian/projects/Launch|Launch]]",
      epic: "[[03-impression/_obsidian/epics/Focus|Focus]]",
    });

    const task = mergeKanbanTaskDefaults(
      {
        title: "New task",
        status: "in-progress",
        contexts: ["02-matt-derman"],
        projects: ["[[02-matt-derman/_obsidian/projects/Brand|Brand]]"],
        customFrontmatter: {
          epic: "[[02-matt-derman/_obsidian/epics/Content|Content]]",
        },
      },
      defaults
    );

    expect(task).toMatchObject({
      status: "in-progress",
      contexts: ["02-matt-derman"],
      projects: ["[[02-matt-derman/_obsidian/projects/Brand|Brand]]"],
      customFrontmatter: {
        epic: "[[02-matt-derman/_obsidian/epics/Content|Content]]",
      },
    });
  });
});
