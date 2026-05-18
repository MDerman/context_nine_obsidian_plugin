import { describe, expect, it } from "vitest";
import { FALLBACK_VAULT_COMMANDS, parseVaultCommandMetadata } from "../src/vault-command-metadata";

describe("vault command metadata", () => {
  it("loads valid command metadata", () => {
    const result = parseVaultCommandMetadata(
      JSON.stringify([
        {
          id: "refresh",
          label: "Refresh",
          description: "Refresh everything.",
          args: ["refresh"],
          aliases: ["r"],
        },
      ])
    );

    expect(result.warning).toBeUndefined();
    expect(result.commands).toEqual([
      {
        id: "refresh",
        label: "Refresh",
        description: "Refresh everything.",
        args: ["refresh"],
        aliases: ["r"],
      },
    ]);
  });

  it("falls back when JSON cannot be parsed", () => {
    const result = parseVaultCommandMetadata("{nope");

    expect(result.commands).toBe(FALLBACK_VAULT_COMMANDS);
    expect(result.warning).toContain("Could not parse");
  });

  it("falls back when command args are not an array of strings", () => {
    const result = parseVaultCommandMetadata(
      JSON.stringify([{ id: "refresh", label: "Refresh", description: "Refresh", args: "refresh" }])
    );

    expect(result.commands).toBe(FALLBACK_VAULT_COMMANDS);
    expect(result.warning).toContain("invalid command");
  });
});
