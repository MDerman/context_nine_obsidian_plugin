import { describe, expect, it } from "vitest";
import { parseAttachmentSpans, replaceSpans } from "../src/link-parser";

describe("link parser", () => {
  it("finds wiki and markdown attachment links", () => {
    const markdown = [
      "hello",
      "![[master/_obsidian/attachments/_inbox/a.png]]",
      "[[03-impression/_obsidian/tasks/Task.md|Task]]",
      "![alt](master/_obsidian/attachments/_inbox/b.jpg)",
    ].join("\n");

    const spans = parseAttachmentSpans(markdown);

    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.target)).toEqual([
      "master/_obsidian/attachments/_inbox/a.png",
      "master/_obsidian/attachments/_inbox/b.jpg",
    ]);
  });

  it("rewrites spans from the end of the document", () => {
    const markdown = "![[old.png]] and ![[other.jpg]]";
    const spans = parseAttachmentSpans(markdown);

    const rewritten = replaceSpans(markdown, [
      { span: spans[0]!, replacement: "![[new.png]]" },
      { span: spans[1]!, replacement: "![[newer.jpg]]" },
    ]);

    expect(rewritten).toBe("![[new.png]] and ![[newer.jpg]]");
  });
});

