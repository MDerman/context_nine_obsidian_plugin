import type { Editor, EditorPosition, TFile } from "obsidian";

export const DEFAULT_KNOWN_ROOTS = [
  "01-personal",
  "02-matt-derman",
  "03-impression",
  "04-dev",
  "05-claudeche",
  "library",
  "master",
  "shared",
  "wiki",
];

export interface MasterPluginSettings {
  defaultContext: string;
  lastContext: string;
  knownRoots: string[];
  attachmentInboxPath: string;
  appleNotesAttachmentsPath: string;
  enableAutoAttachmentRouter: boolean;
  routeIntervalSeconds: number;
  enableGcalSync: boolean;
  gcalSyncIntervalSeconds: number;
  deleteSourceAfterCapture: boolean;
  hoveredDeleteEnabled: boolean;
  taskModalDeleteButtonEnabled: boolean;
  vaultCommand: string;
  vaultRoot: string;
}

export const DEFAULT_SETTINGS: MasterPluginSettings = {
  defaultContext: "03-impression",
  lastContext: "03-impression",
  knownRoots: DEFAULT_KNOWN_ROOTS,
  attachmentInboxPath: "master/_obsidian/attachments/_inbox",
  appleNotesAttachmentsPath: "master/system/inbox/apple-notes-attachments",
  enableAutoAttachmentRouter: true,
  routeIntervalSeconds: 60,
  enableGcalSync: true,
  gcalSyncIntervalSeconds: 300,
  deleteSourceAfterCapture: true,
  hoveredDeleteEnabled: true,
  taskModalDeleteButtonEnabled: true,
  vaultCommand: "vault",
  vaultRoot: "/Users/matthewderman/My Drive/Workspace",
};

export interface CapturedSelection {
  editor: Editor;
  sourceFile: TFile;
  text: string;
  from: EditorPosition;
  to: EditorPosition;
}

export interface TaskInfoLike {
  path: string;
  title?: string;
  status?: string;
  priority?: string;
  contexts?: string[];
  projects?: string[];
  epic?: string;
  customFrontmatter?: Record<string, unknown>;
  archived?: boolean;
  details?: string;
}

export interface TaskNotesPluginLike {
  settings?: {
    defaultTaskPriority?: string;
    defaultTaskStatus?: string;
    enableNaturalLanguageInput?: boolean;
    statusSuggestionTrigger?: string;
    nlpTriggers?: {
      triggers?: Array<{ propertyId: string; trigger: string; enabled: boolean }>;
    };
    customPriorities?: Array<{ value: string; label?: string }>;
    customStatuses?: Array<{ value: string; label?: string; isCompleted?: boolean }>;
    fieldMapping?: Record<string, string>;
  };
  saveSettings?: () => Promise<void>;
  openTaskCreationModal?: (prePopulatedValues?: Partial<TaskInfoLike>) => void;
  openTaskEditModal?: (task: TaskInfoLike, onTaskUpdated?: (task: TaskInfoLike) => void) => void;
  taskService?: {
    createTask?: (
      taskData: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<{ file: TFile; taskInfo: TaskInfoLike }>;
  };
  cacheManager?: {
    getAllTasks?: () => Promise<TaskInfoLike[]>;
    getTaskInfo?: (path: string) => Promise<TaskInfoLike | null>;
    clearCacheEntry?: (path: string) => void;
  };
  fieldMapper?: {
    toUserField?: (field: string) => string;
  };
  notifyDataChanged?: (path?: string, clearAll?: boolean, updateViews?: boolean) => void;
}
