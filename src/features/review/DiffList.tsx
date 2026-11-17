import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScreen } from "@/app/navigation/screen.ts";
import type { ChangedFile, DiffLine, PendingComment, ReviewThread } from "@/data/review";
import { useT, type Translate } from "@/i18n/index.tsx";
import { CodeTokens } from "@/ui/code/CodeTokens.tsx";
import type { DiffRow, LineSelection } from "./diff-rows.ts";
import { lineTokens, useDiffTokens } from "./diff-tokens.ts";
import styles from "./Diff.module.css";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const OVERSCAN_ROWS = 24;
const COARSE_POINTER = "(pointer: coarse)";
const TAB_COLUMNS = 4;
const ESTIMATES: Readonly<Record<DiffRow["kind"], number>> = {
  file: 52,
  message: 64,
  hunk: 32,
  line: 24,
  thread: 180,
  pending: 120,
};
const MARKERS: Readonly<Record<DiffLine["kind"], string>> = { add: "+", del: "−", context: " " };

export interface DiffListHandle {
  moveToHunk: (direction: 1 | -1) => boolean;
  focusRow: (index: number, align?: "start" | "center") => void;
}

export interface DiffListProps {
  label: string;
  rows: readonly DiffRow[];
  /** Draft edits should not invalidate highlighting. */
  highlightRows?: readonly DiffRow[];
  /** Commit files can use different languages. */
  path: string | null;
  softWrap: boolean;
  stickyInset: number;
  selection?: LineSelection | null;
  onLinePress?: (lineIndex: number) => void;
  onLongPress?: (lineIndex: number) => void;
  onSelectionDrag?: (selection: LineSelection) => void;
  renderThread?: (thread: ReviewThread) => ReactNode;
  renderPending?: (comment: PendingComment) => ReactNode;
  renderFile?: (file: ChangedFile) => ReactNode;
  renderMessage?: (row: Extract<DiffRow, { kind: "message" }>) => ReactNode;
  ref?: Ref<DiffListHandle>;
}

/** Handles obscure the underlying row. */
function lineIndexAt(x: number, y: number): number | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (element.closest("[data-handle]")) continue;
    const row = element.closest<HTMLElement>("[data-line-index]");
    if (row) return Number(row.dataset.lineIndex);
  }
  return null;
}

function lineLabel(t: Translate, line: DiffLine): string {
  if (line.kind === "add") return t("review.diff.addedLine", { line: line.newLine ?? 0 });
  if (line.kind === "del") return t("review.diff.removedLine", { line: line.oldLine ?? 0 });
  return t("review.diff.unchangedLine", { line: line.newLine ?? 0 });
}

function widestColumns(rows: readonly DiffRow[]): number {
  let widest = 0;
  for (const row of rows) {
    if (row.kind !== "line") continue;
    const { text } = row.line;
    const tabs = text.split("\t").length - 1;
    widest = Math.max(widest, text.length + tabs * (TAB_COLUMNS - 1));
  }
  return widest;
}

function maxDigits(rows: readonly DiffRow[]): number {
  let largest = 0;
  for (const row of rows) {
    if (row.kind === "line") {
      largest = Math.max(largest, row.line.oldLine ?? 0, row.line.newLine ?? 0);
    }
  }
  return String(largest).length;
}

/** Nested scrolling interferes with screen navigation. */
export function DiffList(props: DiffListProps) {
  const t = useT();
  const { scroller } = useScreen();
  const list = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  // Range handles remount during a drag.
  const drag = useRef<{ pointerId: number; anchor: number } | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const { rows, selection, onLongPress, onLinePress, onSelectionDrag, stickyInset } = props;
  const tokens = useDiffTokens(props.highlightRows ?? rows, props.path);
  const columns = useMemo(() => widestColumns(rows), [rows]);
  const digits = useMemo(() => maxDigits(rows), [rows]);
  const hunkTotal = useMemo(() => rows.filter((row) => row.kind === "hunk").length, [rows]);
  const first = selection ? Math.min(selection.anchor, selection.focus) : null;
  const last = selection ? Math.max(selection.anchor, selection.focus) : null;

  const measureMargin = useCallback(() => {
    const root = scroller.current;
    const element = list.current;
    if (!root || !element || root.clientHeight === 0) return;
    setScrollMargin(
      element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop,
    );
  }, [scroller]);

  useLayoutEffect(() => {
    const root = scroller.current;
    const element = list.current;
    if (!root || !element) return;
    measureMargin();
    // Surrounding layout shifts the scroll offset.
    const observer = new ResizeObserver(measureMargin);
    for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
      for (
        let sibling = node.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      ) {
        observer.observe(sibling);
      }
    }
    return () => {
      observer.disconnect();
    };
  }, [scroller, measureMargin]);

  // eslint-disable-next-line react-hooks/incompatible-library -- Compiler disabled.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => ESTIMATES[rows[index]?.kind ?? "line"],
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: OVERSCAN_ROWS,
    scrollMargin,
    scrollPaddingStart: stickyInset,
  });

  const focusRow = (index: number, align: "start" | "center") => {
    virtualizer.scrollToIndex(index, { align });
    const key = rows[index]?.key ?? "";
    // Virtual rows mount after scrolling settles.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = list.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
        const target = row?.querySelector<HTMLElement>('[tabindex="-1"]') ?? row;
        target?.focus({ preventScroll: true });
      });
    });
  };

  useImperativeHandle(
    props.ref,
    () => ({
      moveToHunk: (direction) => {
        const root = scroller.current;
        if (!root) return false;
        const position = root.scrollTop - scrollMargin + stickyInset;
        const hunks = rows.flatMap((row, index) => (row.kind === "hunk" ? [index] : []));
        const starts = hunks.map((index) => ({
          index,
          start: virtualizer.measurementsCache[index]?.start ?? 0,
        }));
        const target =
          direction === 1
            ? starts.find((hunk) => hunk.start > position + 1)
            : starts.findLast((hunk) => hunk.start < position - 1);
        if (!target) return false;
        focusRow(target.index, "start");
        return true;
      },
      focusRow: (index, align = "center") => {
        focusRow(index, align);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focusRow reads these
    [rows, scroller, scrollMargin, stickyInset, virtualizer],
  );

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onLongPress || !event.isPrimary) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, [data-handle]")) return;
    const lineIndex = lineIndexAt(event.clientX, event.clientY);
    if (lineIndex === null) return;
    cancelPress();
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null;
        suppressClick.current = true;
        onLongPress(lineIndex);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragging = drag.current;
    if (dragging?.pointerId === event.pointerId) {
      const focus = lineIndexAt(event.clientX, event.clientY);
      if (focus !== null) onSelectionDrag?.({ anchor: dragging.anchor, focus });
      return;
    }
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) {
      cancelPress();
    }
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
    cancelPress();
  };

  const dragHandle = (end: "start" | "end") => ({
    "data-handle": end,
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      if (first === null || last === null) return;
      event.stopPropagation();
      event.preventDefault();
      drag.current = { pointerId: event.pointerId, anchor: end === "start" ? last : first };
      list.current?.setPointerCapture(event.pointerId);
    },
  });

  const renderRow = (row: DiffRow) => {
    switch (row.kind) {
      case "file":
        return props.renderFile?.(row.file);
      case "message":
        return props.renderMessage?.(row);
      case "hunk":
        return (
          <div
            className={styles.hunk}
            role="heading"
            aria-level={3}
            tabIndex={-1}
            aria-label={t("review.diff.hunk", {
              ordinal: row.ordinal,
              total: hunkTotal,
              header: row.header,
            })}
          >
            <code aria-hidden>{row.header}</code>
          </div>
        );
      case "thread":
        return props.renderThread?.(row.thread);
      case "pending":
        return props.renderPending?.(row.comment);
      case "line": {
        const { line, lineIndex } = row;
        const selected = first !== null && last !== null && lineIndex >= first && lineIndex <= last;
        const numbers = (
          <>
            <span className={styles.number}>{line.oldLine ?? ""}</span>
            <span className={styles.number}>{line.newLine ?? ""}</span>
          </>
        );
        return (
          <div
            className={styles.line}
            data-kind={line.kind}
            data-line-index={lineIndex}
            data-selected={selected || undefined}
          >
            {onLinePress ? (
              <button
                type="button"
                className={styles.gutter}
                aria-label={lineLabel(t, line)}
                aria-pressed={selected}
                onClick={() => {
                  onLinePress(lineIndex);
                }}
              >
                {numbers}
              </button>
            ) : (
              <>
                <span className={styles.gutter} aria-hidden>
                  {numbers}
                </span>
                <span className={styles.srOnly}>{lineLabel(t, line)}</span>
              </>
            )}
            <span className={styles.marker} aria-hidden>
              {MARKERS[line.kind]}
            </span>
            <code className={styles.text}>
              <CodeTokens text={line.text} tokens={lineTokens(tokens, row.key, line.text)} />
            </code>
            {selected && lineIndex === first ? (
              <span
                className={styles.handle}
                data-end="start"
                {...dragHandle("start")}
                aria-hidden
              />
            ) : null}
            {selected && lineIndex === last ? (
              <span className={styles.handle} data-end="end" {...dragHandle("end")} aria-hidden />
            ) : null}
          </div>
        );
      }
    }
  };

  return (
    <div className={styles.scroller} data-wrap={props.softWrap || undefined}>
      <div
        ref={list}
        role="group"
        aria-label={props.label}
        className={styles.diff}
        data-wrap={props.softWrap || undefined}
        data-digits={digits}
        style={{
          height: virtualizer.getTotalSize(),
          minWidth: props.softWrap ? undefined : `calc(${String(digits * 2 + columns)}ch + 4.5rem)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onContextMenu={(event) => {
          if (onLongPress && window.matchMedia(COARSE_POINTER).matches) event.preventDefault();
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              data-row-key={row.key}
              data-raised={
                (row.kind === "line" && (row.lineIndex === first || row.lineIndex === last)) ||
                undefined
              }
              className={styles.row}
              style={{ transform: `translateY(${String(virtualRow.start - scrollMargin)}px)` }}
            >
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
