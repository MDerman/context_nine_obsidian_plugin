import { describe, expect, it } from "vitest";
import { parseAdditionalArgs } from "../src/vault-args";

describe("vault args parser", () => {
  it("parses plain args", () => {
    expect(parseAdditionalArgs("--context-folders 03-impression --all")).toEqual({
      args: ["--context-folders", "03-impression", "--all"],
    });
  });

  it("parses quoted args", () => {
    expect(parseAdditionalArgs('--date "2026-05-15" --name "My Context"')).toEqual({
      args: ["--date", "2026-05-15", "--name", "My Context"],
    });
  });

  it("parses escaped spaces", () => {
    expect(parseAdditionalArgs("--name My\\ Context")).toEqual({
      args: ["--name", "My Context"],
    });
  });

  it("returns an empty arg list for empty input", () => {
    expect(parseAdditionalArgs("   ")).toEqual({ args: [] });
  });

  it("returns a validation error for an unterminated quote", () => {
    const parsed = parseAdditionalArgs('--name "My Context');
    expect(parsed.args).toEqual([]);
    expect(parsed.error).toContain("Unterminated");
  });
});
