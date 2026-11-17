import { useEffect, useState } from "react";
import { languageForPath } from "@/data/repo";
import { highlightLines, type HighlightedLine } from "@/ui/code/highlight.ts";
import type { DiffRow } from "./diff-rows.ts";

/** Context preserves grammar on both sides. */
interface SideDocument {
  language: string;
  lines: string[];
  keys: (string | null)[];
}

function append(document: SideDocument, text: string, key: string | null): void {
  document.lines.push(text);
  document.keys.push(key);
}

/** Separate sides keep grammar state valid. */
export function sideDocuments(rows: readonly DiffRow[], path: string | null): SideDocument[] {
  const documents: SideDocument[] = [];
  const open = (filePath: string | null) => {
    const language = filePath === null ? null : languageForPath(filePath);
    if (language === null) return null;
    const sides: { old: SideDocument; new: SideDocument } = {
      old: { language, lines: [], keys: [] },
      new: { language, lines: [], keys: [] },
    };
    documents.push(sides.new, sides.old);
    return sides;
  };
  let sides: { old: SideDocument; new: SideDocument } | null = open(path);
  for (const row of rows) {
    if (row.kind === "file") sides = open(row.file.path);
    if (row.kind !== "line" || !sides) continue;
    const { kind, text } = row.line;
    if (kind !== "add") append(sides.old, text, kind === "del" ? row.key : null);
    if (kind !== "del") append(sides.new, text, row.key);
  }
  return documents.filter((document) => document.keys.some((key) => key !== null));
}

export function useDiffTokens(
  rows: readonly DiffRow[],
  path: string | null,
): ReadonlyMap<string, HighlightedLine> | null {
  const [result, setResult] = useState<ReadonlyMap<string, HighlightedLine> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const documents = sideDocuments(rows, path);
    Promise.all(
      documents.map(async (document) => ({
        keys: document.keys,
        lines: await highlightLines(document.lines, document.language, controller.signal),
      })),
    ).then(
      (highlighted) => {
        const tokens = new Map<string, HighlightedLine>();
        for (const { keys, lines } of highlighted) {
          keys.forEach((key, index) => {
            const line = lines?.[index];
            if (key !== null && line) tokens.set(key, line);
          });
        }
        setResult(tokens);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) reportError(error);
      },
    );
    return () => {
      controller.abort();
    };
  }, [rows, path]);

  return result;
}

/** Stale tokens apply only to unchanged text. */
export function lineTokens(
  tokens: ReadonlyMap<string, HighlightedLine> | null,
  key: string,
  text: string,
): HighlightedLine | undefined {
  const line = tokens?.get(key);
  return line?.map((token) => token.text).join("") === text ? line : undefined;
}
