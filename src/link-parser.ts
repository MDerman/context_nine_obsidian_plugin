import { isAttachmentPath } from "./path-utils";

export type LinkKind = "wiki" | "markdown";

export interface LinkSpan {
  kind: LinkKind;
  start: number;
  end: number;
  original: string;
  embedded: boolean;
  target: string;
  alias?: string;
  label?: string;
}

const LOCAL_SKIP_SCHEMES = [
  "http://",
  "https://",
  "mailto:",
  "obsidian://",
  "file://",
  "data:",
];

export function isLocalTarget(target: string): boolean {
  const lower = target.trim().toLowerCase();
  return lower.length > 0 && !LOCAL_SKIP_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

export function stripFragment(target: string): string {
  return target.split("#")[0];
}

export function cleanMarkdownTarget(raw: string): string {
  let target = raw.trim();
  if (target.startsWith("<") && target.includes(">")) {
    target = target.slice(1, target.indexOf(">"));
  } else {
    const titleMatch = target.match(/^([^ \t]+)[ \t]+["'][^"']+["']$/);
    if (titleMatch) {
      target = titleMatch[1] ?? target;
    }
  }
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

export function parseLinkSpans(markdown: string): LinkSpan[] {
  const spans: LinkSpan[] = [];
  const wikiRe = /(!?)\[\[([^\]\n]+)\]\]/g;
  let wikiMatch: RegExpExecArray | null;
  while ((wikiMatch = wikiRe.exec(markdown)) !== null) {
    const content = wikiMatch[2] ?? "";
    const [rawTarget, alias] = content.split("|", 2);
    const target = stripFragment(rawTarget ?? "").trim();
    if (isLocalTarget(target)) {
      spans.push({
        kind: "wiki",
        start: wikiMatch.index,
        end: wikiMatch.index + wikiMatch[0].length,
        original: wikiMatch[0],
        embedded: wikiMatch[1] === "!",
        target,
        alias,
      });
    }
  }

  const markdownRe = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRe.exec(markdown)) !== null) {
    const target = stripFragment(cleanMarkdownTarget(markdownMatch[3] ?? ""));
    if (isLocalTarget(target)) {
      spans.push({
        kind: "markdown",
        start: markdownMatch.index,
        end: markdownMatch.index + markdownMatch[0].length,
        original: markdownMatch[0],
        embedded: markdownMatch[1] === "!",
        target,
        label: markdownMatch[2] ?? "",
      });
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

export function parseAttachmentSpans(markdown: string): LinkSpan[] {
  return parseLinkSpans(markdown).filter((span) => isAttachmentPath(span.target));
}

export function replaceSpans(
  markdown: string,
  replacements: Array<{ span: LinkSpan; replacement: string }>
): string {
  const sorted = [...replacements].sort((a, b) => b.span.start - a.span.start);
  let output = markdown;
  for (const { span, replacement } of sorted) {
    output = output.slice(0, span.start) + replacement + output.slice(span.end);
  }
  return output;
}

