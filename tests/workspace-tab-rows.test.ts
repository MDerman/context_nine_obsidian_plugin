import { describe, expect, it } from "vitest";
import { classifyTabRows } from "../src/workspace-tab-rows";

describe("workspace tab row classification", () => {
  it("does not classify a single row as a wrapped layout", () => {
    expect(classifyTabRows([0, 0, 0])).toEqual({
      multiRow: false,
      bottomRow: [false, false, false],
    });
  });

  it("marks only the final visual row", () => {
    expect(classifyTabRows([0, 0, 36, 36, 72])).toEqual({
      multiRow: true,
      bottomRow: [false, false, false, false, true],
    });
  });

  it("tolerates subpixel differences within one row", () => {
    expect(classifyTabRows([0.2, 0.7, 36.1, 36.8])).toEqual({
      multiRow: true,
      bottomRow: [false, false, true, true],
    });
  });

  it("handles empty tab groups", () => {
    expect(classifyTabRows([])).toEqual({ multiRow: false, bottomRow: [] });
  });
});
