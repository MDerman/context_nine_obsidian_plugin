export const ATTACHMENT_EXTENSIONS = new Set([
  "avif",
  "csv",
  "gif",
  "heic",
  "jpeg",
  "jpg",
  "m4a",
  "mov",
  "mp3",
  "mp4",
  "pdf",
  "png",
  "svg",
  "wav",
  "webp",
]);

export function topRoot(path: string, knownRoots: string[]): string | null {
  const first = normalizeVaultPath(path).split("/")[0];
  return knownRoots.includes(first) ? first : null;
}

export function attachmentFolderForRoot(root: string): string {
  return `${root}/_obsidian/attachments`;
}

export function taskFolderForContext(context: string): string {
  return `${context}/_obsidian/tasks`;
}

export function isTaskFilePath(path: string, knownRoots: string[]): boolean {
  const normalized = normalizeVaultPath(path);
  if (!normalized.endsWith(".md")) {
    return false;
  }
  const root = topRoot(normalized, knownRoots);
  return root !== null && normalized.startsWith(`${root}/_obsidian/tasks/`);
}

export function taskDestinationPathForContext(path: string, context: string): string {
  return normalizeVaultPath(`${taskFolderForContext(context)}/${basename(path)}`);
}

export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

export function basename(path: string): string {
  return normalizeVaultPath(path).split("/").pop() ?? path;
}

export function dirname(path: string): string {
  const parts = normalizeVaultPath(path).split("/");
  parts.pop();
  return parts.join("/");
}

export function extension(path: string): string {
  const name = basename(path);
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function isAttachmentPath(path: string): boolean {
  return ATTACHMENT_EXTENSIONS.has(extension(path));
}

export function splitExtension(fileName: string): { stem: string; ext: string } {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0) {
    return { stem: fileName, ext: "" };
  }
  return { stem: fileName.slice(0, idx), ext: fileName.slice(idx) };
}

export function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\r\n\t]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || "Untitled";
}

export function slugifyTaskTitle(raw: string): string {
  return safeFileName(raw).slice(0, 180);
}

export function firstNonEmptyLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.replace(/^#+\s*/, "").trim())
    .find((part) => part.length > 0);
  return line ? line.slice(0, 120) : "Captured selection";
}
