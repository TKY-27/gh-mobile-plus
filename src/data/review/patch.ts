import { gitHubFailure } from "../internal/errors";

export type DiffSide = "LEFT" | "RIGHT";

export interface DiffLine {
  kind: "add" | "del" | "context";
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: readonly DiffLine[];
}

export interface LineAnchor {
  line: number;
  side: DiffSide;
}

export interface RangeAnchor extends LineAnchor {
  startLine?: number;
  startSide?: DiffSide;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_NEWLINE_MARKER = "\\";
const MIN_FENCE_LENGTH = 3;
const BACKTICK_RUN = /`+/g;

interface OpenHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  nextOld: number;
  nextNew: number;
  oldRemaining: number;
  newRemaining: number;
}

function openHunk(text: string): OpenHunk | null {
  const match = HUNK_HEADER.exec(text);
  if (!match) return null;
  const oldStart = Number(match[1]);
  const newStart = Number(match[3]);
  return {
    header: text,
    oldStart,
    newStart,
    lines: [],
    nextOld: oldStart,
    nextNew: newStart,
    oldRemaining: match[2] === undefined ? 1 : Number(match[2]),
    newRemaining: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function nextLine(hunk: OpenHunk, text: string): DiffLine | null {
  const oldLine = hunk.nextOld;
  const newLine = hunk.nextNew;
  const marker = text.charAt(0);
  if (marker === "+") return { kind: "add", oldLine: null, newLine, text: text.slice(1) };
  if (marker === "-") return { kind: "del", oldLine, newLine: null, text: text.slice(1) };
  // Some tools strip empty context's space.
  const strippedEmpty = text === "" && hunk.oldRemaining > 0 && hunk.newRemaining > 0;
  if (marker === " " || strippedEmpty) {
    return { kind: "context", oldLine, newLine, text: text.slice(1) };
  }
  return null;
}

/** GitHub anchors require absolute line numbers. */
export function parsePatch(patch: string): readonly DiffHunk[] {
  const hunks: OpenHunk[] = [];
  let current: OpenHunk | null = null;
  for (const text of patch.split("\n")) {
    const opened = openHunk(text);
    if (opened) {
      current = opened;
      hunks.push(opened);
      continue;
    }
    if (!current || text.startsWith(NO_NEWLINE_MARKER)) continue;
    const line = nextLine(current, text);
    if (!line) continue;
    current.lines.push(line);
    if (line.kind !== "add") {
      current.nextOld++;
      current.oldRemaining--;
    }
    if (line.kind !== "del") {
      current.nextNew++;
      current.newRemaining--;
    }
  }
  return hunks.map(({ header, oldStart, newStart, lines }) => ({
    header,
    oldStart,
    newStart,
    lines,
  }));
}

export function anchorFor(line: DiffLine): LineAnchor {
  const number = line.kind === "del" ? line.oldLine : line.newLine;
  if (number === null) throw new Error(`Diff ${line.kind} line has no line number`);
  return { line: number, side: line.kind === "del" ? "LEFT" : "RIGHT" };
}

export const BACKWARD_RANGE_MESSAGE =
  "A range cannot start on an added line and end on a removed one";

// GitHub rejects RIGHT starts with LEFT ends.
function startAnchor(start: DiffLine, endSide: DiffSide): LineAnchor | null {
  if (endSide === "RIGHT") return anchorFor(start);
  return start.oldLine === null ? null : { line: start.oldLine, side: "LEFT" };
}

export function canAnchorRange(start: DiffLine, end: DiffLine): boolean {
  return startAnchor(start, anchorFor(end).side) !== null;
}

export function rangeAnchor(start: DiffLine, end: DiffLine): RangeAnchor {
  let last = anchorFor(end);
  let first = startAnchor(start, last.side);
  if (!first) {
    throw gitHubFailure({
      kind: "validation",
      message: BACKWARD_RANGE_MESSAGE,
      fields: ["startSide"],
    });
  }
  if (first.side === last.side && first.line > last.line) [first, last] = [last, first];
  if (first.side === last.side && first.line === last.line) return last;
  return { ...last, startLine: first.line, startSide: first.side };
}

/** GitHub interprets empty suggestions as deletions. */
export function suggestionBlock(lines: readonly string[]): string {
  const runs = lines.flatMap((line) => Array.from(line.matchAll(BACKTICK_RUN), ([run]) => run));
  const longest = Math.max(0, ...runs.map((run) => run.length));
  const fence = "`".repeat(Math.max(MIN_FENCE_LENGTH, longest + 1));
  const body = lines.map((line) => `${line}\n`).join("");
  return `${fence}suggestion\n${body}${fence}`;
}

const SUGGESTION_OPENING = /^ {0,3}(`{3,}|~{3,})[ \t]*suggestion[ \t]*$/;

function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= fence.length && trimmed === fence.charAt(0).repeat(trimmed.length);
}

export function suggestionFrom(markdown: string): string | null {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => SUGGESTION_OPENING.test(line));
  const fence = SUGGESTION_OPENING.exec(lines[start] ?? "")?.[1];
  if (fence === undefined) return null;
  const closing = lines.findIndex((line, index) => index > start && closesFence(line, fence));
  // CommonMark: unclosed fences run to the end.
  const end = closing < 0 ? lines.length : closing;
  return lines
    .slice(start + 1, end)
    .map((line) => `${line}\n`)
    .join("");
}

const LINES_WITH_BREAKS = /[^\n]*\n|[^\n]+/g;
const LINE_BREAK = /\r?\n/;
const TRAILING_LINE_BREAK = /\r?\n$/;

/** Invalid anchors must leave files intact. */
export function applySuggestion(
  text: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string | null {
  const lines = text.match(LINES_WITH_BREAKS) ?? [];
  const first = lines[startLine - 1];
  const last = lines[endLine - 1];
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine > endLine) {
    return null;
  }
  if (first === undefined || last === undefined) return null;
  // Suggestion edits must preserve original line endings.
  const eol = first.endsWith("\r\n") ? "\r\n" : "\n";
  const finalBreak = last.endsWith("\n") ? eol : "";
  const replacementLines =
    replacement === "" ? [] : replacement.replace(TRAILING_LINE_BREAK, "").split(LINE_BREAK);
  const replaced = replacementLines.map(
    (line, index) => line + (index === replacementLines.length - 1 ? finalBreak : eol),
  );
  lines.splice(startLine - 1, endLine - startLine + 1, ...replaced);
  return lines.join("");
}
