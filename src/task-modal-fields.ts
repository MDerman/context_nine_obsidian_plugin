export interface VaultEntityChoice {
  title: string;
  path: string;
  link: string;
}

export function stripMarkdownExtension(path: string): string {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

export function entityLink(path: string, title: string): string {
  return `[[${stripMarkdownExtension(path)}|${title}]]`;
}

export function linkLabel(value: unknown): string | null {
  const text = firstStringValue(value);
  if (!text) {
    return null;
  }
  const aliased = text.match(/^\[\[[^|\]]+\|([^\]]+)\]\]$/);
  if (aliased) {
    return aliased[1].trim() || null;
  }
  const plain = text.match(/^\[\[([^\]]+)\]\]$/);
  if (plain) {
    const target = plain[1].split("|")[0];
    return target.split("/").pop()?.replace(/\.md$/, "").trim() || null;
  }
  return text.trim() || null;
}

export function firstStringValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const item = value.find((part) => typeof part === "string" && part.trim());
    return typeof item === "string" ? item.trim() : null;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

export function vaultCreateArgs(
  kind: "epic" | "project",
  context: string,
  title: string,
  epicTitle?: string | null
): string[] {
  const args = [kind, "create", context, title];
  if (kind === "project" && epicTitle) {
    args.push("--epic", epicTitle);
  }
  return args;
}
