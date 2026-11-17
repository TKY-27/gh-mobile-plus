import { useId, useState } from "react";
import type { DiffLine } from "@/data/review";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import type { DiffRow, LineSelection } from "./diff-rows.ts";
import styles from "./Review.module.css";

const PREVIEW_LENGTH = 40;

function optionLabel(line: DiffLine): string {
  const marker = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const number = line.kind === "del" ? line.oldLine : line.newLine;
  return `${String(number ?? "")} ${marker} ${line.text.trim().slice(0, PREVIEW_LENGTH)}`;
}

export function SelectRangeSheet(props: {
  rows: readonly DiffRow[];
  selection: LineSelection;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (selection: LineSelection) => void;
}) {
  const t = useT();
  const startId = useId();
  const endId = useId();
  const lines = props.rows.flatMap((row) => (row.kind === "line" ? [row] : []));
  const hunk = lines.find((row) => row.lineIndex === props.selection.anchor)?.hunkIndex;
  const choices = lines.filter((row) => row.hunkIndex === hunk);
  const [start, setStart] = useState(Math.min(props.selection.anchor, props.selection.focus));
  const [end, setEnd] = useState(Math.max(props.selection.anchor, props.selection.focus));

  const options = choices.map((row) => (
    <option key={row.lineIndex} value={row.lineIndex}>
      {optionLabel(row.line)}
    </option>
  ));

  return (
    <Sheet isOpen={props.isOpen} onOpenChange={props.onOpenChange} title={t("review.range.title")}>
      <form
        className={styles.rangeSheet}
        onSubmit={(event) => {
          event.preventDefault();
          props.onSelect({ anchor: Math.min(start, end), focus: Math.max(start, end) });
          props.onOpenChange(false);
        }}
      >
        <p className={styles.note}>{t("review.range.hint")}</p>
        <label htmlFor={startId} className={styles.fieldLabel}>
          {t("review.range.start")}
        </label>
        <select
          id={startId}
          className={styles.select}
          value={start}
          onChange={(event) => {
            setStart(Number(event.target.value));
          }}
        >
          {options}
        </select>
        <label htmlFor={endId} className={styles.fieldLabel}>
          {t("review.range.end")}
        </label>
        <select
          id={endId}
          className={styles.select}
          value={end}
          onChange={(event) => {
            setEnd(Number(event.target.value));
          }}
        >
          {options}
        </select>
        <Button type="submit" variant="primary" wide>
          {t("review.range.apply")}
        </Button>
      </form>
    </Sheet>
  );
}
