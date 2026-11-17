import { useState } from "react";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { TextField } from "@/ui/TextField.tsx";
import type { LineRange } from "./CodeView.tsx";
import styles from "./SelectLinesSheet.module.css";

function lineNumber(value: string, lineCount: number): number | null {
  const line = Number(value);
  return Number.isInteger(line) && line >= 1 && line <= lineCount ? line : null;
}

export function SelectLinesSheet(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  lineCount: number;
  initial: LineRange | null;
  onSelect: (range: LineRange) => void;
}) {
  const t = useT();
  const [from, setFrom] = useState(props.initial ? String(props.initial.start) : "");
  const [to, setTo] = useState(props.initial ? String(props.initial.end) : "");
  const start = lineNumber(from, props.lineCount);
  const end = to.trim() === "" ? start : lineNumber(to, props.lineCount);
  const invalid = t("code.selection.invalid", { count: props.lineCount });

  return (
    <Sheet
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      title={t("code.selection.select")}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (start === null || end === null) return;
          props.onSelect({ start: Math.min(start, end), end: Math.max(start, end) });
          props.onOpenChange(false);
        }}
      >
        <div className={styles.fields}>
          <TextField
            label={t("code.selection.from")}
            inputMode="numeric"
            value={from}
            onChange={setFrom}
            isRequired
            isInvalid={from !== "" && start === null}
            validate={() => (from !== "" && start === null ? invalid : null)}
            autoFocus
          />
          <TextField
            label={t("code.selection.to")}
            inputMode="numeric"
            value={to}
            onChange={setTo}
            isInvalid={to.trim() !== "" && end === null}
            validate={() => (to.trim() !== "" && end === null ? invalid : null)}
          />
        </div>
        <Button type="submit" variant="primary" wide isDisabled={start === null || end === null}>
          {t("code.selection.apply")}
        </Button>
      </form>
    </Sheet>
  );
}
