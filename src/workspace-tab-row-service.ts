import { App, Plugin } from "obsidian";
import { classifyTabRows } from "./workspace-tab-rows";

const TAB_LIST_SELECTOR =
  ".workspace .mod-root .workspace-tabs:not(.mod-stacked) > " +
  ".workspace-tab-header-container > .workspace-tab-header-container-inner";
const TAB_SELECTOR = ":scope > .workspace-tab-header";
const MULTI_ROW_CLASS = "omp-tabs-multi-row";
const UPPER_ROW_CLASS = "omp-tab-upper-row";
const BOTTOM_ROW_CLASS = "omp-tab-bottom-row";

export class WorkspaceTabRowService {
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrame: number | null = null;

  constructor(private readonly app: App) {}

  register(plugin: Plugin): void {
    const start = (): void => {
      if (this.mutationObserver) {
        return;
      }

      this.mutationObserver = new MutationObserver(() => this.scheduleRefresh());
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      this.resizeObserver = new ResizeObserver(() => this.scheduleRefresh());
      this.scheduleRefresh();
    };

    this.app.workspace.onLayoutReady(start);
    plugin.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    plugin.registerDomEvent(window, "resize", () => this.scheduleRefresh());
    plugin.register(() => this.destroy());
  }

  private scheduleRefresh(): void {
    if (this.animationFrame !== null) {
      return;
    }

    this.animationFrame = window.requestAnimationFrame(() => {
      this.animationFrame = null;
      this.refresh();
    });
  }

  private refresh(): void {
    const lists = Array.from(document.querySelectorAll<HTMLElement>(TAB_LIST_SELECTOR));
    this.resizeObserver?.disconnect();

    for (const list of lists) {
      this.resizeObserver?.observe(list);
      const tabs = Array.from(list.querySelectorAll<HTMLElement>(TAB_SELECTOR));
      for (const tab of tabs) {
        this.resizeObserver?.observe(tab);
      }

      const classification = classifyTabRows(
        tabs.map((tab) => tab.getBoundingClientRect().top)
      );
      list.classList.toggle(MULTI_ROW_CLASS, classification.multiRow);

      tabs.forEach((tab, index) => {
        const isBottomRow = classification.bottomRow[index] ?? false;
        tab.classList.toggle(BOTTOM_ROW_CLASS, isBottomRow);
        tab.classList.toggle(UPPER_ROW_CLASS, classification.multiRow && !isBottomRow);
      });
    }
  }

  private destroy(): void {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    for (const list of Array.from(document.querySelectorAll<HTMLElement>(TAB_LIST_SELECTOR))) {
      list.classList.remove(MULTI_ROW_CLASS);
      for (const tab of Array.from(list.querySelectorAll<HTMLElement>(TAB_SELECTOR))) {
        tab.classList.remove(UPPER_ROW_CLASS, BOTTOM_ROW_CLASS);
      }
    }
  }
}
