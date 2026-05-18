import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { LinkSpan, parseAttachmentSpans, replaceSpans } from "./link-parser";
import {
  attachmentFolderForRoot,
  basename,
  dirname,
  normalizeVaultPath,
  splitExtension,
  topRoot,
} from "./path-utils";
import type { MasterPluginSettings } from "./types";

export interface RoutedMarkdown {
  markdown: string;
  routedCount: number;
  failedCount: number;
}

export class AttachmentRouter {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => MasterPluginSettings
  ) {}

  async routeMarkdownAttachments(
    markdown: string,
    sourceFile: TFile,
    targetRoot: string,
    targetNotePath?: string
  ): Promise<RoutedMarkdown> {
    const spans = parseAttachmentSpans(markdown);
    const replacements: Array<{ span: LinkSpan; replacement: string }> = [];
    const routedByPath = new Map<string, TFile>();
    let routedCount = 0;
    let failedCount = 0;

    for (const span of spans) {
      const linkedFile = this.resolveLinkedFile(span.target, sourceFile);
      if (!linkedFile) {
        failedCount += 1;
        continue;
      }

      let routedFile = routedByPath.get(linkedFile.path);
      if (!routedFile) {
        routedFile = await this.routeFileToRoot(linkedFile, targetRoot);
        routedByPath.set(linkedFile.path, routedFile);
        if (routedFile.path !== linkedFile.path) {
          routedCount += 1;
        }
      }

      replacements.push({
        span,
        replacement: this.generateWikiLink(routedFile, span, targetNotePath),
      });
    }

    return {
      markdown: replaceSpans(markdown, replacements),
      routedCount,
      failedCount,
    };
  }

  async routeInboxForActiveNote(note: TFile, onlyPaths?: Set<string>): Promise<number> {
    const settings = this.getSettings();
    const root = topRoot(note.path, settings.knownRoots);
    if (!root) {
      return 0;
    }

    const content = await this.app.vault.read(note);
    const spans = parseAttachmentSpans(content);
    const replacements: Array<{ span: LinkSpan; replacement: string }> = [];
    let routed = 0;

    for (const span of spans) {
      const linkedFile = this.resolveLinkedFile(span.target, note);
      if (!linkedFile || !this.isInboxAttachment(linkedFile)) {
        continue;
      }
      if (onlyPaths && !onlyPaths.has(linkedFile.path)) {
        continue;
      }

      const routedFile = await this.routeFileToRoot(linkedFile, root, true);
      replacements.push({
        span,
        replacement: this.generateWikiLink(routedFile, span, note.path),
      });
      routed += routedFile.path === linkedFile.path ? 0 : 1;
    }

    if (replacements.length > 0) {
      await this.app.vault.modify(note, replaceSpans(content, replacements));
    }

    return routed;
  }

  async listInboxFiles(): Promise<TFile[]> {
    const inbox = this.app.vault.getAbstractFileByPath(this.getSettings().attachmentInboxPath);
    if (!(inbox instanceof TFolder)) {
      return [];
    }
    return this.flattenFiles(inbox);
  }

  isInboxPath(path: string): boolean {
    const inboxPath = normalizeVaultPath(this.getSettings().attachmentInboxPath);
    const normalized = normalizeVaultPath(path);
    return normalized === inboxPath || normalized.startsWith(`${inboxPath}/`);
  }

  private resolveLinkedFile(target: string, sourceFile: TFile): TFile | null {
    const normalizedTarget = normalizeVaultPath(target);
    const fromCache = this.app.metadataCache.getFirstLinkpathDest(normalizedTarget, sourceFile.path);
    if (fromCache instanceof TFile) {
      return fromCache;
    }

    const absolute = this.app.vault.getAbstractFileByPath(normalizedTarget);
    if (absolute instanceof TFile) {
      return absolute;
    }

    const relative = this.app.vault.getAbstractFileByPath(
      normalizePath(`${dirname(sourceFile.path)}/${normalizedTarget}`)
    );
    return relative instanceof TFile ? relative : null;
  }

  private async routeFileToRoot(file: TFile, targetRoot: string, forceMove = false): Promise<TFile> {
    const targetFolder = attachmentFolderForRoot(targetRoot);
    if (file.path.startsWith(`${targetFolder}/`)) {
      return file;
    }

    await this.ensureFolder(targetFolder);
    const destination = await this.uniqueDestination(file, targetFolder);
    if (destination.existingFile) {
      if (forceMove || this.shouldMoveSource(file)) {
        await this.app.vault.delete(file);
      }
      return destination.existingFile;
    }

    if (forceMove || this.shouldMoveSource(file)) {
      await this.app.vault.rename(file, destination.path);
    } else {
      const buffer = await this.app.vault.readBinary(file);
      await this.app.vault.createBinary(destination.path, buffer);
    }

    const routed = this.app.vault.getAbstractFileByPath(destination.path);
    if (!(routed instanceof TFile)) {
      throw new Error(`Attachment route failed: ${destination.path}`);
    }
    return routed;
  }

  private async uniqueDestination(
    source: TFile,
    targetFolder: string
  ): Promise<{ path: string; existingFile?: TFile }> {
    const sourceHash = await this.hashFile(source);
    const cleanName = basename(source.path);
    const { stem, ext } = splitExtension(cleanName);

    for (let idx = 0; idx < 500; idx += 1) {
      const suffix = idx === 0 ? "" : ` (${idx + 1})`;
      const path = normalizePath(`${targetFolder}/${stem}${suffix}${ext}`);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (!(existing instanceof TFile)) {
        return { path };
      }
      if ((await this.hashFile(existing)) === sourceHash) {
        return { path, existingFile: existing };
      }
    }

    throw new Error(`Could not find a free destination for ${source.path}`);
  }

  private generateWikiLink(file: TFile, span: LinkSpan, targetNotePath?: string): string {
    const alias = span.alias || span.label || undefined;
    if (targetNotePath) {
      try {
        const link = this.app.fileManager.generateMarkdownLink(file, targetNotePath, "", alias);
        return span.embedded && !link.startsWith("!") ? `!${link}` : link;
      } catch {
        // Fall through to vault-absolute wikilink.
      }
    }

    const pipe = alias ? `|${alias}` : "";
    return `${span.embedded ? "!" : ""}[[${file.path}${pipe}]]`;
  }

  private shouldMoveSource(file: TFile): boolean {
    const settings = this.getSettings();
    const path = normalizeVaultPath(file.path);
    const inbox = normalizeVaultPath(settings.attachmentInboxPath);
    const apple = normalizeVaultPath(settings.appleNotesAttachmentsPath);
    return path.startsWith(`${inbox}/`) || path.startsWith(`${apple}/`);
  }

  private isInboxAttachment(file: TFile): boolean {
    return this.isInboxPath(file.path);
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizeVaultPath(folderPath);
    const parts = normalized.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private flattenFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile) {
        files.push(child);
      } else if (child instanceof TFolder) {
        files.push(...this.flattenFiles(child));
      }
    }
    return files;
  }

  private async hashFile(file: TFile): Promise<string> {
    const buffer = await this.app.vault.readBinary(file);
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }

    let hash = 2166136261;
    for (const byte of new Uint8Array(buffer)) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return `fnv-${hash >>> 0}-${buffer.byteLength}`;
  }
}

export function fileFromAbstract(file: TAbstractFile | null): TFile | null {
  return file instanceof TFile ? file : null;
}

export function noticeRouteResult(count: number): void {
  new Notice(count === 1 ? "Routed 1 attachment." : `Routed ${count} attachments.`);
}
