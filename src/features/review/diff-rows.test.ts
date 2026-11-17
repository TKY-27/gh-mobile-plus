import { describe, expect, it } from "vitest";
import { parsePatch, rangeAnchor, type ReviewThread } from "@/data/review";
import {
  clampSelection,
  commitRows,
  fileRows,
  hideWhitespaceChanges,
  selectedLines,
  type DiffRow,
} from "./diff-rows.ts";

const PATCH = [
  "@@ -1,4 +1,4 @@",
  " import a",
  "-const x = 1;",
  "+const  x = 1;",
  " const y = 2;",
  "-old();",
  "@@ -20,2 +20,3 @@",
  " keep();",
  "+added();",
  " tail();",
].join("\n");

function thread(overrides: Partial<ReviewThread>): ReviewThread {
  return {
    id: "T1",
    path: "a.ts",
    line: 21,
    startLine: null,
    side: "RIGHT",
    isResolved: false,
    isOutdated: false,
    viewerCanResolve: true,
    comments: [],
    hasMoreComments: false,
    ...overrides,
  };
}

function kinds(rows: readonly DiffRow[]): string[] {
  return rows.map((row) => (row.kind === "line" ? row.line.kind : row.kind));
}

describe("hideWhitespaceChanges", () => {
  it("turns whitespace-only replacements into context on the new side", () => {
    const [first] = hideWhitespaceChanges(parsePatch(PATCH));
    expect(first?.lines.map((line) => line.kind)).toEqual(["context", "context", "context", "del"]);
    expect(first?.lines[1]).toEqual({
      kind: "context",
      oldLine: 2,
      newLine: 2,
      text: "const  x = 1;",
    });
  });

  it("keeps real changes", () => {
    const hunks = parsePatch("@@ -1 +1 @@\n-a = 1\n+a = 2");
    expect(hideWhitespaceChanges(hunks)).toEqual(hunks);
  });
});

describe("fileRows", () => {
  it("places threads and pending comments after their anchor line", () => {
    const pending = { id: "P1", path: "a.ts", line: 2, side: "LEFT" as const, body: "Why?" };
    const { rows, unplaced } = fileRows(
      parsePatch(PATCH),
      [thread({}), thread({ id: "T2", line: null, isOutdated: true })],
      [pending],
    );
    expect(kinds(rows)).toEqual([
      "hunk",
      "context",
      "del",
      "pending",
      "add",
      "context",
      "del",
      "hunk",
      "context",
      "add",
      "thread",
      "context",
    ]);
    expect(unplaced.map((entry) => entry.id)).toEqual(["T2"]);
  });

  it("numbers lines across hunks", () => {
    const { rows } = fileRows(parsePatch(PATCH), [], []);
    const indices = rows.flatMap((row) => (row.kind === "line" ? [row.lineIndex] : []));
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("selection", () => {
  const { rows } = fileRows(parsePatch(PATCH), [], []);

  it("clamps the focus to the anchor's hunk", () => {
    expect(clampSelection(rows, { anchor: 1, focus: 6 })).toEqual({ anchor: 1, focus: 4 });
    expect(clampSelection(rows, { anchor: 6, focus: 2 })).toEqual({ anchor: 6, focus: 5 });
  });

  it("returns lines in display order for range anchors", () => {
    const lines = selectedLines(rows, { anchor: 3, focus: 1 });
    expect(lines.map((line) => line.text)).toEqual([
      "const x = 1;",
      "const  x = 1;",
      "const y = 2;",
    ]);
    const [start, end] = [lines[0], lines.at(-1)];
    if (!start || !end) throw new Error("expected lines");
    expect(rangeAnchor(start, end)).toEqual({
      line: 3,
      side: "RIGHT",
      startLine: 2,
      startSide: "LEFT",
    });
  });
});

describe("commitRows", () => {
  it("adds file headers and messages for missing patches", () => {
    const base = { previousPath: null, status: "modified" as const, viewed: "unviewed" as const };
    const rows = commitRows([
      { ...base, path: "big.lock", additions: 9000, deletions: 1, hunks: null, blobUrl: "" },
      { ...base, path: "logo.png", additions: 0, deletions: 0, hunks: [], blobUrl: "" },
      {
        ...base,
        path: "a.ts",
        additions: 1,
        deletions: 0,
        hunks: parsePatch("@@ -0,0 +1 @@\n+x"),
        blobUrl: "",
      },
    ]);
    expect(kinds(rows)).toEqual(["file", "message", "file", "message", "file", "hunk", "add"]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});
