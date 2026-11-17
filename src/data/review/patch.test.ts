import { describe, expect, it } from "vitest";
import { largeDiffPatch, LARGE_DIFF_LINES } from "./fixtures/large-diff";
import lineMapping from "./fixtures/line-mapping.json";
import pullFiles from "./fixtures/pull-files.json";
import {
  anchorFor,
  applySuggestion,
  canAnchorRange,
  parsePatch,
  rangeAnchor,
  suggestionBlock,
  suggestionFrom,
  type DiffLine,
} from "./patch";

function patchOf(path: string): string {
  const patch = pullFiles.find((file) => file.filename === path)?.patch;
  if (patch === undefined) throw new Error(`Fixture ${path} has no patch`);
  return patch;
}

const greetingLines = parsePatch(patchOf("src/greeting.ts")).flatMap((hunk) => hunk.lines);
const baseLines = lineMapping.base.split("\n");
const headLines = lineMapping.head.split("\n");

function lineWithText(kind: DiffLine["kind"], text: string): DiffLine {
  const line = greetingLines.find((entry) => entry.kind === kind && entry.text === text);
  if (!line) throw new Error(`No ${kind} line "${text}"`);
  return line;
}

describe("parsePatch", () => {
  it("numbers every line exactly as the base and head files", () => {
    expect(greetingLines).toHaveLength(26);
    for (const line of greetingLines) {
      if (line.oldLine !== null) expect(baseLines[line.oldLine - 1]).toBe(line.text);
      if (line.newLine !== null) expect(headLines[line.newLine - 1]).toBe(line.text);
    }
  });

  it("keeps hunk headers with section text and their start lines", () => {
    const hunks = parsePatch(patchOf("src/greeting.ts"));
    expect(hunks.map(({ header, oldStart, newStart }) => ({ header, oldStart, newStart }))).toEqual(
      [
        { header: "@@ -1,13 +1,14 @@", oldStart: 1, newStart: 1 },
        {
          header: "@@ -23,7 +24,7 @@ export function whisper(name: string): string {",
          oldStart: 23,
          newStart: 24,
        },
      ],
    );
  });

  it("skips the no-newline marker without shifting numbers", () => {
    expect(parsePatch(patchOf("README.md"))[0]?.lines).toEqual([
      { kind: "context", oldLine: 1, newLine: 1, text: "# Hello Mobile" },
      { kind: "context", oldLine: 2, newLine: 2, text: "" },
      { kind: "del", oldLine: 3, newLine: null, text: "A tiny greeting library." },
      { kind: "add", oldLine: null, newLine: 3, text: "A tiny greeting library with i18n." },
      { kind: "context", oldLine: 4, newLine: 4, text: "" },
      { kind: "del", oldLine: 5, newLine: null, text: "Run `pnpm test`." },
      { kind: "add", oldLine: null, newLine: 5, text: "Run `pnpm test`." },
    ]);
  });

  it("reads empty context lines whose leading space was stripped", () => {
    expect(parsePatch("@@ -4,3 +4,3 @@\n a\n\n-b\n+c\n")[0]?.lines).toEqual([
      { kind: "context", oldLine: 4, newLine: 4, text: "a" },
      { kind: "context", oldLine: 5, newLine: 5, text: "" },
      { kind: "del", oldLine: 6, newLine: null, text: "b" },
      { kind: "add", oldLine: null, newLine: 6, text: "c" },
    ]);
  });

  it("handles added and removed files and omitted hunk counts", () => {
    const added = parsePatch(patchOf("src/i18n.ts"))[0];
    expect(added?.oldStart).toBe(0);
    expect(added?.lines.at(-1)).toEqual({ kind: "add", oldLine: null, newLine: 9, text: "}" });
    const removed = parsePatch(patchOf("docs/old-guide.md"))[0];
    expect(removed?.lines.map((line) => line.oldLine)).toEqual([1, 2, 3]);
    expect(parsePatch("@@ -7 +7 @@\n-x\n+y")[0]?.lines).toHaveLength(2);
  });

  it("keeps a deleted line that starts with dashes as content", () => {
    expect(parsePatch("@@ -1 +0,0 @@\n--- not a header")[0]?.lines).toEqual([
      { kind: "del", oldLine: 1, newLine: null, text: "-- not a header" },
    ]);
  });

  it("parses a 5,000-line diff with consistent numbering", () => {
    const [hunk] = parsePatch(largeDiffPatch());
    expect(hunk?.lines).toHaveLength(LARGE_DIFF_LINES);
    const last = hunk?.lines.at(-1);
    const added = hunk?.lines.filter((line) => line.kind === "add").length ?? 0;
    const context = hunk?.lines.filter((line) => line.kind === "context").length ?? 0;
    expect(last?.newLine).toBe(added + context);
  });
});

describe("anchors", () => {
  it("anchors deletions on the left and other lines on the right", () => {
    expect(anchorFor(lineWithText("add", 'import { translate } from "./i18n";'))).toEqual({
      line: 2,
      side: "RIGHT",
    });
    expect(
      anchorFor(lineWithText("del", "export function greet(name: string): Greeting {")),
    ).toEqual({ line: 8, side: "LEFT" });
    expect(anchorFor(lineWithText("context", "export interface Greeting {"))).toEqual({
      line: 4,
      side: "RIGHT",
    });
  });

  it("collapses a one-line range and orders a same-side range", () => {
    const added = lineWithText("add", "  return { text, locale };");
    expect(rangeAnchor(added, added)).toEqual({ line: 11, side: "RIGHT" });
    const first = lineWithText(
      "add",
      "export function greet(name: string, locale = DEFAULT_LOCALE): Greeting {",
    );
    expect(rangeAnchor(added, first)).toEqual({
      line: 11,
      side: "RIGHT",
      startLine: 9,
      startSide: "RIGHT",
    });
  });

  it("spans sides with the start side taken from the start line", () => {
    const deleted = lineWithText("del", 'export const DEFAULT_LOCALE = "en";');
    const added = lineWithText("add", 'export const DEFAULT_LOCALE = "ja";');
    expect(rangeAnchor(deleted, added)).toEqual({
      line: 30,
      side: "RIGHT",
      startLine: 29,
      startSide: "LEFT",
    });
  });

  it("anchors a context start on the left when the range ends on a deletion", () => {
    const context = lineWithText(
      "context",
      "export function repeat(name: string, times: number): string {",
    );
    const deleted = lineWithText(
      "del",
      '  return Array.from({ length: times }, () => greet(name).text).join(" ");',
    );
    expect(canAnchorRange(context, deleted)).toBe(true);
    expect(rangeAnchor(context, deleted)).toEqual({
      line: 26,
      side: "LEFT",
      startLine: 25,
      startSide: "LEFT",
    });
  });

  it("rejects a range from an added line to a later deletion", () => {
    const added = lineWithText(
      "add",
      '  return Array.from({ length: times }, () => greet(name).text).join("\\n");',
    );
    const deleted = lineWithText("del", 'export const DEFAULT_LOCALE = "en";');
    expect(canAnchorRange(added, deleted)).toBe(false);
    expect(() => rangeAnchor(added, deleted)).toThrow(
      expect.objectContaining({ kind: "validation", fields: ["startSide"] }),
    );
  });
});

describe("suggestions", () => {
  it("uses a fence longer than any backtick run inside", () => {
    expect(suggestionBlock(["const x = `value`", "```"])).toBe(
      "````suggestion\nconst x = `value`\n```\n````",
    );
    expect(suggestionBlock(["plain"])).toBe("```suggestion\nplain\n```");
    expect(suggestionBlock([])).toBe("```suggestion\n```");
  });

  it("reads back what suggestionBlock writes", () => {
    const lines = ["a", "", "```nested```"];
    expect(suggestionFrom(`Try this:\n\n${suggestionBlock(lines)}\n\nThanks`)).toBe(
      "a\n\n```nested```\n",
    );
    expect(suggestionFrom(suggestionBlock([]))).toBe("");
    expect(suggestionFrom("No suggestion here.\n```ts\ncode\n```")).toBeNull();
    expect(suggestionFrom("```suggestion\r\nx\r\n```")).toBe("x\n");
  });

  it("replaces a line range and keeps line endings", () => {
    expect(applySuggestion("a\nb\nc\n", 2, 2, "B\n")).toBe("a\nB\nc\n");
    expect(applySuggestion("a\nb\nc\n", 1, 2, "x\ny\nz\n")).toBe("x\ny\nz\nc\n");
    expect(applySuggestion("a\r\nb\r\n", 2, 2, "B\n")).toBe("a\r\nB\r\n");
    expect(applySuggestion("a\nb", 2, 2, "B\n")).toBe("a\nB");
    expect(applySuggestion("a\nb", 2, 2, "B")).toBe("a\nB");
  });

  it("deletes the range for an empty replacement and keeps a blank line", () => {
    expect(applySuggestion("a\nb\nc\n", 2, 3, "")).toBe("a\n");
    expect(applySuggestion("a\nb\nc\n", 2, 2, "\n")).toBe("a\n\nc\n");
  });

  it("rejects ranges outside the file", () => {
    expect(applySuggestion("a\nb\n", 3, 3, "x\n")).toBeNull();
    expect(applySuggestion("a\nb\n", 0, 1, "x\n")).toBeNull();
    expect(applySuggestion("a\nb\n", 2, 1, "x\n")).toBeNull();
    expect(applySuggestion("", 1, 1, "x\n")).toBeNull();
  });
});
