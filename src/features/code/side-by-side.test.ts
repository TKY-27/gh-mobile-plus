import { describe, expect, it } from "vitest";
import { diffLines } from "@/data/commit";
import { sideBySide } from "./side-by-side.ts";

function numbered(count: number, prefix = "line"): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${String(index + 1)}`).join("\n");
}

describe("sideBySide", () => {
  it("pairs a replaced line on one row", () => {
    expect(sideBySide(diffLines("a\nold\nc", "a\nnew\nc"))).toEqual([
      {
        kind: "pair",
        left: { line: 1, text: "a", changed: false },
        right: { line: 1, text: "a", changed: false },
      },
      {
        kind: "pair",
        left: { line: 2, text: "old", changed: true },
        right: { line: 2, text: "new", changed: true },
      },
      {
        kind: "pair",
        left: { line: 3, text: "c", changed: false },
        right: { line: 3, text: "c", changed: false },
      },
    ]);
  });

  it("leaves the shorter side empty for unbalanced blocks", () => {
    const rows = sideBySide(diffLines("a", "a\nb\nc"));
    expect(rows.slice(1)).toEqual([
      { kind: "pair", left: null, right: { line: 2, text: "b", changed: true } },
      { kind: "pair", left: null, right: { line: 3, text: "c", changed: true } },
    ]);
  });

  it("folds unchanged runs beyond three lines of context", () => {
    const before = numbered(20);
    const after = before.replace("line 10\n", "line ten\n");
    const rows = sideBySide(diffLines(before, after));
    expect(
      rows.map((row) => (row.kind === "gap" ? `gap ${String(row.hidden)}` : row.left?.line)),
    ).toEqual(["gap 6", 7, 8, 9, 10, 11, 12, 13, "gap 7"]);
  });
});
