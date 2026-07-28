import { MarkdownView, Notice, TFile, type App, type Plugin, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import {
  REFRESH_COMPLETION_MARKER_PATH,
  activePeriodsForDate,
  localDateId,
  parseRefreshCompletionPayload,
  rolloverTargetPath,
  type RefreshCompletionPayload,
} from "./periodic-tab-rollover";

export interface PeriodicTabRolloverResult {
  updated: number;
  missingTargets: string[];
  ignoredDate?: string;
}

interface PeriodicTabRolloverOptions {
  now?: () => Date;
  retryAttempts?: number;
  retryDelayMs?: number;
  markerPollMs?: number;
}

export class PeriodicTabRolloverService {
  private readonly now: () => Date;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly markerPollMs: number;
  private lastHandledRunId: string | null = null;
  private activeRollover: Promise<PeriodicTabRolloverResult> | null = null;

  constructor(
    private readonly app: App,
    options: PeriodicTabRolloverOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.retryAttempts = options.retryAttempts ?? 10;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.markerPollMs = options.markerPollMs ?? 60_000;
  }

  register(plugin: Plugin): void {
    this.app.workspace.onLayoutReady(() => {
      plugin.registerEvent(this.app.vault.on("create", (file) => this.handleMarkerFile(file)));
      plugin.registerEvent(this.app.vault.on("modify", (file) => this.handleMarkerFile(file)));
      plugin.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          if (file.path === REFRESH_COMPLETION_MARKER_PATH || oldPath === REFRESH_COMPLETION_MARKER_PATH) {
            void this.consumeCompletionMarker();
          }
        })
      );
      plugin.registerInterval(
        window.setInterval(() => {
          void this.consumeCompletionMarker();
        }, this.markerPollMs)
      );

      void this.rollForwardToToday("startup");
      void this.consumeCompletionMarker();
    });
  }

  async handleCli(date: string | undefined, runId: string | undefined): Promise<PeriodicTabRolloverResult> {
    const today = localDateId(this.now());
    if (date && date !== today) {
      return { updated: 0, missingTargets: [], ignoredDate: date };
    }
    if (runId) {
      this.lastHandledRunId = runId;
    }
    return this.rollForwardToToday("CLI");
  }

  async rollForwardToToday(source = "manual"): Promise<PeriodicTabRolloverResult> {
    if (this.activeRollover) {
      return this.activeRollover;
    }
    this.activeRollover = this.performRollover(source).finally(() => {
      this.activeRollover = null;
    });
    return this.activeRollover;
  }

  private handleMarkerFile(file: TAbstractFile): void {
    if (file.path === REFRESH_COMPLETION_MARKER_PATH) {
      void this.consumeCompletionMarker();
    }
  }

  private async consumeCompletionMarker(): Promise<void> {
    const payload = await this.readCompletionMarker();
    if (!payload || payload.runId === this.lastHandledRunId) {
      return;
    }
    this.lastHandledRunId = payload.runId;
    if (payload.effectiveDate !== localDateId(this.now())) {
      return;
    }
    await this.rollForwardToToday("vault refresh");
  }

  private async readCompletionMarker(): Promise<RefreshCompletionPayload | null> {
    try {
      if (!(await this.app.vault.adapter.exists(REFRESH_COMPLETION_MARKER_PATH))) {
        return null;
      }
      const raw = await this.app.vault.adapter.read(REFRESH_COMPLETION_MARKER_PATH);
      return parseRefreshCompletionPayload(JSON.parse(raw) as unknown);
    } catch (error) {
      console.warn("[Context Nine] Could not read vault refresh completion marker", error);
      return null;
    }
  }

  private async performRollover(source: string): Promise<PeriodicTabRolloverResult> {
    const periods = activePeriodsForDate(this.now());
    const activeLeaf = this.app.workspace.activeLeaf;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const missingTargets = new Set<string>();
    let updated = 0;

    for (const leaf of leaves) {
      const path = filePathFromLeaf(leaf);
      const targetPath = path ? rolloverTargetPath(path, periods) : null;
      if (!targetPath) {
        continue;
      }
      const target = await this.resolveTargetFile(targetPath);
      if (!target) {
        missingTargets.add(targetPath);
        continue;
      }
      if (leaf.view instanceof MarkdownView) {
        await leaf.view.save();
      }
      const currentState = leaf.getViewState();
      const preservedState = { ...(currentState.state ?? {}) };
      delete preservedState.file;
      await leaf.openFile(target, {
        active: leaf === activeLeaf,
        state: preservedState,
      });
      updated += 1;
    }

    if (activeLeaf && this.app.workspace.activeLeaf !== activeLeaf) {
      this.app.workspace.setActiveLeaf(activeLeaf, { focus: false });
    }

    const result = { updated, missingTargets: [...missingTargets] };
    if (updated > 0) {
      new Notice(`Context Nine updated ${updated} past periodic tab${updated === 1 ? "" : "s"}.`);
      console.log(`[Context Nine] Updated ${updated} past periodic tab(s) after ${source}.`);
    }
    if (result.missingTargets.length > 0) {
      console.warn(
        `[Context Nine] Could not update periodic tabs because current notes were missing: ${result.missingTargets.join(", ")}`
      );
    }
    return result;
  }

  private async resolveTargetFile(path: string): Promise<TFile | null> {
    for (let attempt = 0; attempt < this.retryAttempts; attempt += 1) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        return file;
      }
      if (attempt + 1 < this.retryAttempts) {
        await delay(this.retryDelayMs);
      }
    }
    return null;
  }
}

function filePathFromLeaf(leaf: WorkspaceLeaf): string | null {
  const file = leaf.getViewState().state?.file;
  return typeof file === "string" ? file : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
