import { expect, test } from "vitest";
import { parsePatch } from "@/data/review";
import { fileRows } from "./diff-rows.ts";
import { lineTokens, sideDocuments } from "./diff-tokens.ts";

test("keys each line once, with context in both sides", () => {
  const { rows } = fileRows(
    parsePatch("@@ -1,2 +1,2 @@\n const a = 1;\n-let b = 2;\n+const b = 2;"),
    [],
    [],
  );
  const [newSide, oldSide] = sideDocuments(rows, "src/a.ts");
  expect(newSide).toEqual({
    language: "typescript",
    lines: ["const a = 1;", "const b = 2;"],
    keys: ["line:0", "line:2"],
  });
  expect(oldSide).toEqual({
    language: "typescript",
    lines: ["const a = 1;", "let b = 2;"],
    keys: [null, "line:1"],
  });
});

test("skips files without a grammar", () => {
  const { rows } = fileRows(parsePatch("@@ -1 +1 @@\n-a\n+b"), [], []);
  expect(sideDocuments(rows, "notes.unknownext")).toEqual([]);
});

test("reuses stale tokens only for identical text", () => {
  const tokens = new Map([
    [
      "line:0",
      [
        { kind: "keyword" as const, text: "const" },
        { kind: null, text: " a" },
      ],
    ],
  ]);
  expect(lineTokens(tokens, "line:0", "const a")).toBe(tokens.get("line:0"));
  expect(lineTokens(tokens, "line:0", "let a")).toBeUndefined();
  expect(lineTokens(null, "line:0", "const a")).toBeUndefined();
});
