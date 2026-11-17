import type {
  ChangedFile,
  DiffHunk,
  DiffLine,
  DiffSide,
  PendingComment,
  ReviewThread,
} from "@/data/review";

const WHITESPACE = /\s+/g;

export type DiffRow =
  | { kind: "file"; key: string; file: ChangedFile }
  | { kind: "message"; key: string; file: ChangedFile; reason: "tooLarge" | "noTextChanges" }
  | { kind: "hunk"; key: string; header: string; hunkIndex: number; ordinal: number }
  | { kind: "line"; key: string; line: DiffLine; hunkIndex: number; lineIndex: number }
  | { kind: "thread"; key: string; thread: ReviewThread }
  | { kind: "pending"; key: string; comment: PendingComment };

export interface LineSelection {
  anchor: number;
  focus: number;
}

function withoutWhitespace(text: string): string {
  return text.replace(WHITESPACE, "");
}

function collapseRun(deletions: readonly DiffLine[], additions: readonly DiffLine[]): DiffLine[] {
  const whitespaceOnly =
    deletions.length === additions.length &&
    deletions.every(
      (line, at) => withoutWhitespace(line.text) === withoutWhitespace(additions[at]?.text ?? ""),
    );
  if (!whitespaceOnly) return [...deletions, ...additions];
  return additions.map((addition, at) => ({
    kind: "context",
    oldLine: deletions[at]?.oldLine ?? null,
    newLine: addition.newLine,
    text: addition.text,
  }));
}

export function hideWhitespaceChanges(hunks: readonly DiffHunk[]): readonly DiffHunk[] {
  return hunks.map((hunk) => {
    const lines: DiffLine[] = [];
    let deletions: DiffLine[] = [];
    let additions: DiffLine[] = [];
    const flush = () => {
      lines.push(...collapseRun(deletions, additions));
      deletions = [];
      additions = [];
    };
    for (const line of hunk.lines) {
      if (line.kind === "del" && additions.length > 0) flush();
      if (line.kind === "del") deletions.push(line);
      else if (line.kind === "add") additions.push(line);
      else {
        flush();
        lines.push(line);
      }
    }
    flush();
    return { ...hunk, lines };
  });
}

export function sideMatches(line: DiffLine, side: DiffSide, number: number): boolean {
  if (side === "LEFT") return line.kind !== "add" && line.oldLine === number;
  return line.kind !== "del" && line.newLine === number;
}

function anchoredTo<T extends { side: DiffSide; line: number | null }>(
  line: DiffLine,
  entries: readonly T[],
  placed: Set<T>,
): T[] {
  return entries.filter((entry) => {
    if (placed.has(entry) || entry.line === null || !sideMatches(line, entry.side, entry.line)) {
      return false;
    }
    placed.add(entry);
    return true;
  });
}

export function fileRows(
  hunks: readonly DiffHunk[],
  threads: readonly ReviewThread[],
  pending: readonly PendingComment[],
): { rows: DiffRow[]; unplaced: ReviewThread[] } {
  const rows: DiffRow[] = [];
  const placedThreads = new Set<ReviewThread>();
  const placedPending = new Set<PendingComment>();
  let lineIndex = 0;
  hunks.forEach((hunk, hunkIndex) => {
    rows.push({
      kind: "hunk",
      key: `hunk:${String(hunkIndex)}`,
      header: hunk.header,
      hunkIndex,
      ordinal: hunkIndex + 1,
    });
    for (const line of hunk.lines) {
      rows.push({ kind: "line", key: `line:${String(lineIndex)}`, line, hunkIndex, lineIndex });
      lineIndex++;
      for (const thread of anchoredTo(line, threads, placedThreads)) {
        rows.push({ kind: "thread", key: `thread:${thread.id}`, thread });
      }
      for (const comment of anchoredTo(line, pending, placedPending)) {
        rows.push({ kind: "pending", key: `pending:${comment.id}`, comment });
      }
    }
  });
  return { rows, unplaced: threads.filter((thread) => !placedThreads.has(thread)) };
}

export function commitRows(files: readonly ChangedFile[]): DiffRow[] {
  return files.flatMap((file, fileIndex): DiffRow[] => {
    const prefix = `${String(fileIndex)}:`;
    const header: DiffRow = { kind: "file", key: `${prefix}file`, file };
    if (file.hunks === null) {
      return [header, { kind: "message", key: `${prefix}message`, file, reason: "tooLarge" }];
    }
    if (file.hunks.length === 0) {
      return [header, { kind: "message", key: `${prefix}message`, file, reason: "noTextChanges" }];
    }
    const { rows } = fileRows(file.hunks, [], []);
    return [header, ...rows.map((row) => ({ ...row, key: prefix + row.key }))];
  });
}

/** GitHub rejects ranges spanning hunks. */
export function clampSelection(rows: readonly DiffRow[], selection: LineSelection): LineSelection {
  const hunkOf = new Map<number, number>();
  for (const row of rows) if (row.kind === "line") hunkOf.set(row.lineIndex, row.hunkIndex);
  const hunk = hunkOf.get(selection.anchor);
  let focus = selection.focus;
  const step = focus > selection.anchor ? -1 : 1;
  while (focus !== selection.anchor && hunkOf.get(focus) !== hunk) focus += step;
  return { anchor: selection.anchor, focus };
}

export function selectedLines(
  rows: readonly DiffRow[],
  selection: LineSelection,
): readonly DiffLine[] {
  const first = Math.min(selection.anchor, selection.focus);
  const last = Math.max(selection.anchor, selection.focus);
  return rows.flatMap((row) =>
    row.kind === "line" && row.lineIndex >= first && row.lineIndex <= last ? [row.line] : [],
  );
}
