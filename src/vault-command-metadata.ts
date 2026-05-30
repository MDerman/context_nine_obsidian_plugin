import type { App } from "obsidian";

export interface VaultCommandDefinition {
  id: string;
  label: string;
  description: string;
  args: string[];
  aliases?: string[];
  cockpit?: boolean;
  palette?: boolean;
  promptArgs?: VaultCommandPromptArg[];
}

export interface VaultCommandPromptArg {
  label: string;
  placeholder?: string;
  argName?: string;
}

export interface VaultCommandLoadResult {
  commands: VaultCommandDefinition[];
  warning?: string;
}

export const VAULT_COMMAND_METADATA_PATH = "_master/system/scripts/vault-commands.json";
const LEGACY_VAULT_COMMAND_METADATA_PATH = "master/system/scripts/vault-commands.json";

export const FALLBACK_VAULT_COMMANDS: VaultCommandDefinition[] = [
  {
    id: "refresh",
    label: "Refresh",
    description: "Ingest configured Apple Notes, then regenerate agent context.",
    args: ["refresh"],
    palette: true,
  },
  {
    id: "folder-register",
    label: "Folder Register",
    description: "Register an existing context folder and regenerate vault wiring.",
    args: ["folder", "register"],
    palette: true,
    promptArgs: [{ label: "Context folder", placeholder: "impression", argName: "name" }],
  },
  {
    id: "upgrade",
    label: "Upgrade",
    description: "Apply public bootstrap vault updates.",
    args: ["upgrade", "--apply"],
    palette: true,
  },
  {
    id: "sync",
    label: "Sync Apple Notes",
    description: "Import the configured Apple Note into the vault inbox.",
    args: ["sync"],
    aliases: ["apple"],
  },
  {
    id: "context",
    label: "Context",
    description: "Regenerate compact agent-readable context and dashboard files.",
    args: ["context"],
  },
  {
    id: "content",
    label: "Content Schedules",
    description: "Generate current content schedule notes.",
    args: ["content"],
  },
  {
    id: "attachments-dry-run",
    label: "Attachments Dry Run",
    description: "Preview attachment routing and cleanup without changing files.",
    args: ["attachments"],
  },
  {
    id: "attachments-apply",
    label: "Attachments Apply",
    description: "Apply attachment routing and cleanup.",
    args: ["attachments", "--apply"],
  },
  {
    id: "profile",
    label: "Profile Sync",
    description: "Patch root Obsidian settings and refresh the reusable bootstrap profile.",
    args: ["profile"],
  },
];

export function parseVaultCommandMetadata(json: string): VaultCommandLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      commands: FALLBACK_VAULT_COMMANDS,
      warning: `Could not parse ${VAULT_COMMAND_METADATA_PATH}: ${messageForError(error)}`,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      commands: FALLBACK_VAULT_COMMANDS,
      warning: `${VAULT_COMMAND_METADATA_PATH} must contain a JSON array.`,
    };
  }

  const commands: VaultCommandDefinition[] = [];
  for (const [index, item] of parsed.entries()) {
    const command = normalizeCommand(item);
    if (!command) {
      return {
        commands: FALLBACK_VAULT_COMMANDS,
        warning: `${VAULT_COMMAND_METADATA_PATH} has an invalid command at index ${index}.`,
      };
    }
    commands.push(command);
  }

  if (commands.length === 0) {
    return {
      commands: FALLBACK_VAULT_COMMANDS,
      warning: `${VAULT_COMMAND_METADATA_PATH} does not define any commands.`,
    };
  }

  return { commands };
}

export async function loadVaultCommandMetadata(app: App): Promise<VaultCommandLoadResult> {
  try {
    const json = await app.vault.adapter.read(VAULT_COMMAND_METADATA_PATH);
    return parseVaultCommandMetadata(json);
  } catch (error) {
    try {
      const json = await app.vault.adapter.read(LEGACY_VAULT_COMMAND_METADATA_PATH);
      return parseVaultCommandMetadata(json);
    } catch {
      return {
        commands: FALLBACK_VAULT_COMMANDS,
        warning: `Could not read ${VAULT_COMMAND_METADATA_PATH}: ${messageForError(error)}`,
      };
    }
  }
}

function normalizeCommand(value: unknown): VaultCommandDefinition | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.description !== "string" ||
    !Array.isArray(value.args) ||
    !value.args.every((arg) => typeof arg === "string")
  ) {
    return null;
  }
  if (
    value.aliases !== undefined &&
    (!Array.isArray(value.aliases) || !value.aliases.every((alias) => typeof alias === "string"))
  ) {
    return null;
  }
  if (value.cockpit !== undefined && typeof value.cockpit !== "boolean") {
    return null;
  }
  if (value.palette !== undefined && typeof value.palette !== "boolean") {
    return null;
  }
  if (
    value.promptArgs !== undefined &&
    (!Array.isArray(value.promptArgs) || !value.promptArgs.every(isPromptArg))
  ) {
    return null;
  }

  return {
    id: value.id,
    label: value.label,
    description: value.description,
    args: value.args,
    aliases: value.aliases,
    cockpit: value.cockpit,
    palette: value.palette,
    promptArgs: value.promptArgs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPromptArg(value: unknown): value is VaultCommandPromptArg {
  if (!isRecord(value) || typeof value.label !== "string") {
    return false;
  }
  if (value.placeholder !== undefined && typeof value.placeholder !== "string") {
    return false;
  }
  if (value.argName !== undefined && typeof value.argName !== "string") {
    return false;
  }
  return true;
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
