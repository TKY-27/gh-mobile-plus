import type { diffLines } from "@/data/commit";

type EditLine = ReturnType<typeof diffLines>[number];

export interface SideCell {
  line: number;
  text: string;
  changed: boolean;
}

export type SideRow =
  { kind: "pair"; left: SideCell | null; right: SideCell | null } | { kind: "gap"; hidden: number };

const CONTEXT_LINES = 3;

function cell(line: number | null, text: string, changed: boolean): SideCell | null {
  return line === null ? null : { line, text, changed };
}

export function sideBySide(lines: readonly EditLine[]): readonly SideRow[] {
  const pairs: { left: SideCell | null; right: SideCell | null }[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.kind === "context") {
      pairs.push({
        left: cell(line.oldLine, line.text, false),
        right: cell(line.newLine, line.text, false),
      });
      index++;
      continue;
    }
    const removed: EditLine[] = [];
    const added: EditLine[] = [];
    for (let next = lines[index]; next && next.kind !== "context"; next = lines[++index]) {
      (next.kind === "del" ? removed : added).push(next);
    }
    for (let row = 0; row < Math.max(removed.length, added.length); row++) {
      const left = removed[row];
      const right = added[row];
      pairs.push({
        left: left ? cell(left.oldLine, left.text, true) : null,
        right: right ? cell(right.newLine, right.text, true) : null,
      });
    }
  }

  const rows: SideRow[] = [];
  let run: typeof pairs = [];
  const flush = (atStart: boolean, atEnd: boolean) => {
    const keepBefore = atStart ? 0 : CONTEXT_LINES;
    const keepAfter = atEnd ? 0 : CONTEXT_LINES;
    if (run.length > keepBefore + keepAfter) {
      rows.push(...run.slice(0, keepBefore).map((pair) => ({ kind: "pair" as const, ...pair })));
      rows.push({ kind: "gap", hidden: run.length - keepBefore - keepAfter });
      rows.push(
        ...run.slice(run.length - keepAfter).map((pair) => ({ kind: "pair" as const, ...pair })),
      );
    } else {
      rows.push(...run.map((pair) => ({ kind: "pair" as const, ...pair })));
    }
    run = [];
  };
  for (const pair of pairs) {
    const changed = Boolean(pair.left?.changed ?? pair.right?.changed);
    if (!changed) {
      run.push(pair);
      continue;
    }
    flush(rows.length === 0, false);
    rows.push({ kind: "pair", ...pair });
  }
  flush(rows.length === 0, true);
  return rows;
}
