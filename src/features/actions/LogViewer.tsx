import { useDeferredValue, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp, FileWarning } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import {
  MAX_LOG_BYTES,
  parseLog,
  useJobLog,
  type Job,
  type LogBlock,
  type LogGroup,
  type LogLine,
  type LogSpan,
} from "@/data/actions";
import { useIsOffline } from "@/data/status";
import { useT } from "@/i18n/index.tsx";
import { IconButton } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { SearchField } from "@/ui/SearchField.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { themedColor } from "./ansi.ts";
import { LiveLogNotice } from "./LiveLogNotice.tsx";
import styles from "./Actions.module.css";

const LINE_ESTIMATE_PX = 20;
const SKELETON_LINES = 12;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const NETWORK_ERROR = { kind: "network" } as const;
// Varied widths read as text lines.
const SKELETON_MIN_WIDTH_PCT = 40;
const SKELETON_WIDTH_RANGE_PCT = 55;
const SKELETON_WIDTH_STEP_PCT = 37;

type LogRow =
  | { kind: "group"; groupIndex: number; group: LogGroup; expanded: boolean }
  | { kind: "line"; line: LogLine };

interface Match {
  lineNumber: number;
  groupIndex: number | null;
}

function lineText(line: LogLine): string {
  return line.spans.map((span) => span.text).join("");
}

function spanStyle(span: LogSpan): CSSProperties {
  return {
    ...(span.fg ? { color: themedColor(span.fg) } : {}),
    ...(span.bg
      ? { background: `color-mix(in srgb, ${themedColor(span.bg)} 22%, transparent)` }
      : {}),
    ...(span.bold ? { fontWeight: "var(--weight-bold)" } : {}),
    ...(span.italic ? { fontStyle: "italic" } : {}),
    ...(span.underline ? { textDecoration: "underline" } : {}),
  };
}

function highlighted(text: string, needle: string): ReactNode {
  if (needle === "") return text;
  const parts: ReactNode[] = [];
  const haystack = text.toLocaleLowerCase();
  let start = 0;
  let found = haystack.indexOf(needle, start);
  while (found !== -1) {
    parts.push(text.slice(start, found));
    parts.push(<mark key={found}>{text.slice(found, found + needle.length)}</mark>);
    start = found + needle.length;
    found = haystack.indexOf(needle, start);
  }
  parts.push(text.slice(start));
  return parts;
}

function findMatches(blocks: readonly LogBlock[], needle: string): Match[] {
  if (needle === "") return [];
  const matches: Match[] = [];
  blocks.forEach((block, index) => {
    const lines = block.kind === "line" ? [block.line] : block.group.lines;
    for (const line of lines) {
      if (lineText(line).toLocaleLowerCase().includes(needle)) {
        matches.push({
          lineNumber: line.number,
          groupIndex: block.kind === "group" ? index : null,
        });
      }
    }
  });
  return matches;
}

function visibleRows(blocks: readonly LogBlock[], expanded: ReadonlySet<number>): LogRow[] {
  return blocks.flatMap((block, groupIndex): LogRow[] => {
    if (block.kind === "line") return [{ kind: "line", line: block.line }];
    const open = expanded.has(groupIndex);
    const header: LogRow = { kind: "group", groupIndex, group: block.group, expanded: open };
    return open
      ? [header, ...block.group.lines.map((line): LogRow => ({ kind: "line", line }))]
      : [header];
  });
}

function LogLineRow(props: { line: LogLine; needle: string; current: boolean }) {
  return (
    <div className={styles.logLine} data-current={props.current || undefined}>
      <span className={styles.lineNumber} aria-hidden>
        {props.line.number}
      </span>
      <span className={styles.lineText}>
        {props.line.spans.map((span, index) => (
          <span key={index} style={spanStyle(span)}>
            {highlighted(span.text, props.needle)}
          </span>
        ))}
      </span>
    </div>
  );
}

function LogBody(props: { text: string; truncated: boolean }) {
  const t = useT();
  const blocks = useMemo(() => parseLog(props.text), [props.text]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [search, setSearch] = useState("");
  const needle = useDeferredValue(search.trim().toLocaleLowerCase());
  const matches = useMemo(() => findMatches(blocks, needle), [blocks, needle]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [focus, setFocus] = useState<{ index: number } | null>(null);
  const rows = useMemo(() => visibleRows(blocks, expanded), [blocks, expanded]);
  const current =
    matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : undefined;

  const goTo = (index: number) => {
    const match = matches[index];
    if (!match) return;
    setMatchIndex(index);
    const nextExpanded =
      match.groupIndex === null || expanded.has(match.groupIndex)
        ? expanded
        : new Set([...expanded, match.groupIndex]);
    setExpanded(nextExpanded);
    const rowIndex = visibleRows(blocks, nextExpanded).findIndex(
      (row) => row.kind === "line" && row.line.number === match.lineNumber,
    );
    setFocus({ index: rowIndex });
  };
  const step = (delta: number) => {
    if (matches.length === 0) return;
    goTo((Math.min(matchIndex, matches.length - 1) + delta + matches.length) % matches.length);
  };

  const toggle = (groupIndex: number) => {
    const next = new Set(expanded);
    if (!next.delete(groupIndex)) next.add(groupIndex);
    setExpanded(next);
  };

  return (
    <div className={styles.log}>
      <div className={styles.logToolbar}>
        <div className={styles.logSearch}>
          <SearchField
            label={t("actions.log.search")}
            placeholder={t("actions.log.search")}
            value={search}
            onChange={(value) => {
              setSearch(value);
              setMatchIndex(0);
            }}
            onSubmit={() => {
              step(1);
            }}
          />
        </div>
        <span className={styles.matchCount} aria-live="polite">
          {needle === ""
            ? ""
            : matches.length === 0
              ? t("actions.log.noMatches")
              : t("actions.log.matchPosition", {
                  current: Math.min(matchIndex, matches.length - 1) + 1,
                  total: matches.length,
                })}
        </span>
        <IconButton
          label={t("actions.log.previous")}
          isDisabled={matches.length === 0}
          onPress={() => {
            step(-1);
          }}
        >
          <ChevronUp aria-hidden />
        </IconButton>
        <IconButton
          label={t("actions.log.next")}
          isDisabled={matches.length === 0}
          onPress={() => {
            step(1);
          }}
        >
          <ChevronDown aria-hidden />
        </IconButton>
      </div>
      {props.truncated ? (
        <p className={styles.logNotice} role="note">
          <FileWarning aria-hidden />
          {t("actions.log.truncated", { size: MAX_LOG_BYTES / BYTES_PER_MEGABYTE })}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={<FileWarning />}
          title={t("actions.log.empty")}
          message={t("actions.log.emptyMessage")}
        />
      ) : (
        <VirtualList
          items={rows}
          label={t("actions.log.label")}
          estimateSize={LINE_ESTIMATE_PX}
          getKey={(row) => (row.kind === "group" ? `g${String(row.groupIndex)}` : row.line.number)}
          focus={focus}
          renderItem={(row) =>
            row.kind === "group" ? (
              <AriaButton
                className={moduleClass(styles.logGroup)}
                aria-expanded={row.expanded}
                onPress={() => {
                  toggle(row.groupIndex);
                }}
              >
                {row.expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                <span className={styles.lineText}>{row.group.title}</span>
                <span className={styles.groupCount}>
                  {t("actions.log.lines", { count: row.group.lines.length })}
                </span>
              </AriaButton>
            ) : (
              <LogLineRow
                line={row.line}
                needle={needle}
                current={current?.lineNumber === row.line.number}
              />
            )
          }
        />
      )}
    </div>
  );
}

export default function LogViewer(props: { owner: string; repo: string; job: Job }) {
  const t = useT();
  const log = useJobLog(props.owner, props.repo, props.job.id, true);
  const offline = useIsOffline();
  if (log.isPending && log.fetchStatus === "paused") {
    return <ErrorState error={NETWORK_ERROR} onRetry={() => void log.refetch()} />;
  }
  if (log.isPending) {
    return (
      <div className={styles.logSkeleton} aria-busy="true">
        <Spinner size="small" label={t("actions.log.loading")} />
        {Array.from({ length: SKELETON_LINES }, (_, index) => (
          <Skeleton
            key={index}
            width={`${String(SKELETON_MIN_WIDTH_PCT + ((index * SKELETON_WIDTH_STEP_PCT) % SKELETON_WIDTH_RANGE_PCT))}%`}
            height="0.875rem"
          />
        ))}
      </div>
    );
  }
  if (log.isError) {
    // Redirect hosts may block CORS.
    if (log.error.kind === "network" && !offline) {
      return <LiveLogNotice job={props.job} reason="unreadable" />;
    }
    return (
      <ErrorState
        error={log.error}
        fullScreen={isFullScreenError(log.error)}
        onRetry={() => void log.refetch()}
      />
    );
  }
  return <LogBody text={log.data.text} truncated={log.data.truncated} />;
}
