import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScreen } from "@/app/navigation/screen.ts";
import { useT } from "@/i18n/index.tsx";
import { CodeTokens } from "@/ui/code/CodeTokens.tsx";
import { useHighlightedLines } from "@/ui/code/highlight.ts";
import styles from "./CodeView.module.css";

export interface LineRange {
  start: number;
  end: number;
}

const LINE_ESTIMATE_PX = 20;
const OVERSCAN_LINES = 30;
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
const TAB_COLUMNS = 4;
const COARSE_POINTER = "(pointer: coarse)";

function lineAt(target: EventTarget): number | null {
  const row = target instanceof Element ? target.closest<HTMLElement>("[data-line]") : null;
  return row ? Number(row.dataset.line) : null;
}

function widestColumns(lines: readonly string[]): number {
  let widest = 0;
  for (const line of lines) {
    const tabs = line.split("\t").length - 1;
    widest = Math.max(widest, line.length + tabs * (TAB_COLUMNS - 1));
  }
  return widest;
}

export function extendSelection(selection: LineRange, line: number): LineRange | null {
  if (selection.start === line && selection.end === line) return null;
  if (line < selection.start) return { start: line, end: selection.end };
  return { start: selection.start, end: line };
}

export function CodeView(props: {
  lines: readonly string[];
  language: string | null;
  softWrap: boolean;
  selection: LineRange | null;
  onSelectionChange: (selection: LineRange | null) => void;
  scrollToLine: number | null;
}) {
  const t = useT();
  const { scroller } = useScreen();
  const container = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const { lines, selection, onSelectionChange, scrollToLine } = props;
  const tokens = useHighlightedLines(lines, props.language);
  const columns = useMemo(() => widestColumns(lines), [lines]);
  const digits = String(lines.length).length;
  const offset = scrollMargin ?? 0;

  // eslint-disable-next-line react-hooks/incompatible-library -- Virtualizer manages memoization
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => LINE_ESTIMATE_PX,
    overscan: OVERSCAN_LINES,
    scrollMargin: offset,
  });

  useLayoutEffect(() => {
    const element = container.current;
    const root = scroller.current;
    if (!element || !root) return;
    setScrollMargin(
      element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop,
    );
  }, [scroller]);

  useEffect(() => {
    if (scrollToLine === null || scrollMargin === null) return;
    virtualizer.scrollToIndex(scrollToLine - 1, { align: "center" });
  }, [scrollToLine, scrollMargin, virtualizer]);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // No click follows a mobile long press.
    suppressClick.current = false;
    const line = lineAt(event.target);
    if (line === null || !event.isPrimary) return;
    cancelPress();
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null;
        suppressClick.current = true;
        onSelectionChange({ start: line, end: line });
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > MOVE_TOLERANCE_PX) cancelPress();
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const line = lineAt(event.target);
    if (line === null || !selection) return;
    onSelectionChange(extendSelection(selection, line));
  };

  return (
    <div className={styles.scroller}>
      <div
        ref={container}
        role="group"
        aria-label={t("code.viewer.label", { count: lines.length })}
        className={styles.lines}
        data-wrap={props.softWrap || undefined}
        data-digits={digits}
        style={{
          height: virtualizer.getTotalSize(),
          minWidth: props.softWrap ? undefined : `calc(${String(digits + columns)}ch + 3rem)`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClick={onClick}
        onContextMenu={(event) => {
          // Prevent competing long-press handlers.
          if (window.matchMedia(COARSE_POINTER).matches) event.preventDefault();
        }}
      >
        {virtualizer.getVirtualItems().map((virtualLine) => {
          const number = virtualLine.index + 1;
          const selected =
            selection !== null && number >= selection.start && number <= selection.end;
          return (
            <div
              key={virtualLine.key}
              ref={virtualizer.measureElement}
              data-index={virtualLine.index}
              data-line={number}
              data-selected={selected || undefined}
              className={styles.line}
              style={{ transform: `translateY(${String(virtualLine.start - offset)}px)` }}
            >
              <span className={styles.number} aria-hidden>
                {number}
              </span>
              <code className={styles.text}>
                <CodeTokens
                  text={lines[virtualLine.index] ?? ""}
                  tokens={tokens?.[virtualLine.index]}
                />
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
