import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, ExternalLink, FileX2, Space, WrapText } from "lucide-react";
import { ToggleButton } from "react-aria-components/ToggleButton";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { useScreen } from "@/app/navigation/screen.ts";
import { setPreferences, usePreferences } from "@/data/preferences";
import type { PullRequestDetail } from "@/data/pulls";
import {
  canAnchorRange,
  rangeAnchor,
  usePendingReview,
  type ChangedFile,
  type PendingComment,
  type PullFiles,
  type ReviewThread,
} from "@/data/review";
import { useSheetSession } from "@/ui/sheet-session.ts";
import { openExternal } from "@/ui/external.ts";
import { useT } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { Button } from "@/ui/Button.tsx";
import { Checkbox } from "@/ui/Checkbox.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { CommentSheet, type CommentTarget } from "./CommentSheet.tsx";
import {
  clampSelection,
  fileRows,
  hideWhitespaceChanges,
  selectedLines,
  type LineSelection,
} from "./diff-rows.ts";
import { DiffList, type DiffListHandle } from "./DiffList.tsx";
import { useFileSwipe } from "./file-swipe.ts";
import { fileHref, useViewedToggle } from "./FileList.tsx";
import { PendingCard, useDraftDeletion } from "./PendingCard.tsx";
import { ReviewBar, type SelectionSummary } from "./ReviewBar.tsx";
import { SelectRangeSheet } from "./SelectRangeSheet.tsx";
import { SubmitSheet } from "./SubmitSheet.tsx";
import { ThreadCard } from "./ThreadCard.tsx";
import styles from "./Review.module.css";

function splitPath(path: string): { directory: string; name: string } {
  const slash = path.lastIndexOf("/");
  return { directory: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

export function FileReview(props: {
  pull: PullRequestDetail;
  files: PullFiles;
  threads: readonly ReviewThread[];
  file: ChangedFile;
}) {
  const t = useT();
  const router = useRouter();
  const { scroller } = useScreen();
  const preferences = usePreferences();
  const { pull, files, file } = props;
  const pending = usePendingReview(pull.repo.owner, pull.repo.name, pull.number);
  const setViewed = useViewedToggle(pull);
  const diff = useRef<DiffListHandle | null>(null);
  const header = useRef<HTMLDivElement | null>(null);
  const [stickyInset, setStickyInset] = useState(0);
  const [selectionState, setSelectionState] = useState<{
    path: string;
    commitOid: string;
    baseOid: string;
    selection: LineSelection;
  } | null>(null);
  const comment = useSheetSession<CommentTarget>();
  const range = useSheetSession<NonNullable<typeof selectionState>>();
  const submit = useSheetSession<null>();
  const fileIndex = files.files.findIndex((candidate) => candidate.path === file.path);
  const selection =
    selectionState?.path === file.path &&
    selectionState.commitOid === files.headOid &&
    selectionState.baseOid === files.baseOid
      ? selectionState.selection
      : null;

  const threads = useMemo(
    () => props.threads.filter((thread) => thread.path === file.path),
    [props.threads, file.path],
  );
  const drafts = useMemo(
    () =>
      pending.comments.filter(
        (draft) =>
          !!draft.baseOid &&
          draft.path === file.path &&
          draft.commitOid === files.headOid &&
          draft.baseOid === files.baseOid,
      ),
    [pending.comments, file.path, files.headOid, files.baseOid],
  );
  const hunks = useMemo(
    () =>
      file.hunks && preferences.hideWhitespace ? hideWhitespaceChanges(file.hunks) : file.hunks,
    [file.hunks, preferences.hideWhitespace],
  );
  const savedDraft = useRef<Pick<PendingComment, "line" | "side"> | null>(null);
  const lineRows = useMemo(() => fileRows(hunks ?? [], [], []).rows, [hunks]);
  const { rows, unplaced } = useMemo(
    () => fileRows(hunks ?? [], threads, drafts),
    [hunks, threads, drafts],
  );

  // Dismissed sheets can leave focus on body.
  useEffect(() => {
    const saved = savedDraft.current;
    if (!saved) return;
    const index = rows.findLastIndex(
      (row) =>
        row.kind === "pending" &&
        row.comment.line === saved.line &&
        row.comment.side === saved.side,
    );
    if (index < 0) return;
    savedDraft.current = null;
    diff.current?.focusRow(index);
  }, [rows]);

  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [file.path, scroller]);

  useLayoutEffect(() => {
    const element = header.current;
    const root = scroller.current;
    if (!element || !root) return;
    const measure = () => {
      setStickyInset(element.getBoundingClientRect().bottom - root.getBoundingClientRect().top);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [scroller]);

  const goToFile = (direction: 1 | -1) => {
    const next = files.files[fileIndex + direction];
    if (next) router.history.replace(fileHref(pull, next.path));
  };
  const {
    go: stepFile,
    ref: movingSurface,
    ...swipe
  } = useFileSwipe({
    fileKey: file.path,
    enabled: preferences.softWrap && selection === null,
    canGo: (direction) => files.files[fileIndex + direction] !== undefined,
    onSwipe: goToFile,
  });

  const select = (next: LineSelection | null) => {
    setSelectionState(
      next && {
        path: file.path,
        commitOid: files.headOid,
        baseOid: files.baseOid,
        selection: clampSelection(rows, next),
      },
    );
  };

  const pressLine = (lineIndex: number) => {
    if (!selection) {
      select({ anchor: lineIndex, focus: lineIndex });
      return;
    }
    const only = selection.anchor === lineIndex && selection.focus === lineIndex;
    select(only ? null : { anchor: selection.anchor, focus: lineIndex });
  };

  const lines = selection ? selectedLines(rows, selection) : [];
  const firstLine = lines[0];
  const lastLine = lines.at(-1);
  const summary: SelectionSummary | null =
    firstLine && lastLine
      ? {
          lines:
            lines.length === 1
              ? t("review.bar.oneLine")
              : t("review.bar.lineCount", { count: lines.length }),
          problem: !files.baseOid
            ? t("review.bar.refreshDiff")
            : canAnchorRange(firstLine, lastLine)
              ? null
              : t("review.bar.backwardRange"),
          canSuggest: lines.every((line) => line.kind !== "del"),
        }
      : null;

  const startComment = (suggest: boolean) => {
    if (!firstLine || !lastLine || !canAnchorRange(firstLine, lastLine)) return;
    comment.open({
      kind: "new",
      commitOid: files.headOid,
      baseOid: files.baseOid,
      path: file.path,
      anchor: rangeAnchor(firstLine, lastLine),
      lines,
      suggest,
    });
    select(null);
  };

  const deleteDraft = useDraftDeletion(pending);

  const showDraft = (draft: PendingComment) => {
    submit.setOpen(false);
    if (draft.path !== file.path) {
      router.history.replace(fileHref(pull, draft.path));
      return;
    }
    const index = rows.findIndex((row) => row.kind === "pending" && row.comment.id === draft.id);
    if (index >= 0) diff.current?.focusRow(index);
  };

  const { directory, name } = splitPath(file.path);
  const tooLarge = file.hunks === null;

  return (
    <Page title={name}>
      <div ref={header} className={styles.fileHeader}>
        <p className={styles.filePath}>
          <span className={styles.directory}>{directory}</span>
          <span className={styles.fileName}>{name}</span>
        </p>
        <div className={styles.fileTools}>
          <span className={styles.counts}>
            <span className={styles.additions}>+{file.additions}</span>
            <span className={styles.deletions}>−{file.deletions}</span>
          </span>
          <Checkbox
            isSelected={file.viewed === "viewed"}
            onChange={(viewed) => {
              setViewed(file.path, viewed);
            }}
          >
            {t("review.files.viewedShort")}
          </Checkbox>
          <ToggleButton
            className={moduleClass(styles.toggle)}
            isSelected={preferences.softWrap}
            onChange={(softWrap) => {
              setPreferences({ softWrap });
            }}
          >
            <WrapText aria-hidden />
            {t("review.diff.wrap")}
          </ToggleButton>
          <ToggleButton
            className={moduleClass(styles.toggle)}
            isSelected={preferences.hideWhitespace}
            onChange={(hideWhitespace) => {
              setPreferences({ hideWhitespace });
            }}
          >
            <Space aria-hidden />
            {t("review.diff.hideWhitespace")}
          </ToggleButton>
        </div>
      </div>
      {pending.error ? (
        <Banner icon={<CircleAlert />} tone="warning">
          {t("review.pending.saveFailed")}
        </Banner>
      ) : null}
      {unplaced.length > 0 ? (
        <details className={styles.unplaced}>
          <summary>{t("review.thread.unplaced", { count: unplaced.length })}</summary>
          {unplaced.map((thread) => (
            <ThreadCard
              key={thread.id}
              pull={pull}
              thread={thread}
              onReply={(target) => {
                comment.open({ kind: "reply", thread: target });
              }}
            />
          ))}
        </details>
      ) : null}
      <div className={styles.surface} data-swipe={preferences.softWrap || undefined} {...swipe}>
        <div ref={movingSurface}>
          {tooLarge ? (
            <EmptyState
              icon={<FileX2 />}
              title={t("review.diff.tooLargeTitle")}
              message={t("review.diff.tooLargeMessage")}
              action={
                <Button
                  icon={<ExternalLink aria-hidden />}
                  onPress={() => {
                    openExternal(file.blobUrl);
                  }}
                >
                  {t("common.openOnGitHub")}
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<FileX2 />}
              title={t("review.diff.noTextTitle")}
              message={t("review.diff.noTextMessage")}
            />
          ) : (
            <DiffList
              ref={diff}
              label={t("review.diff.label", { path: file.path })}
              rows={rows}
              highlightRows={lineRows}
              path={file.path}
              softWrap={preferences.softWrap}
              stickyInset={stickyInset}
              selection={selection}
              onLinePress={pressLine}
              onLongPress={(lineIndex) => {
                select({ anchor: lineIndex, focus: lineIndex });
              }}
              onSelectionDrag={select}
              renderThread={(thread) => (
                <ThreadCard
                  pull={pull}
                  thread={thread}
                  onReply={(target) => {
                    comment.open({ kind: "reply", thread: target });
                  }}
                />
              )}
              renderPending={(draft) => (
                <PendingCard
                  comment={draft}
                  onEdit={(target) => {
                    comment.open({ kind: "edit", comment: target });
                  }}
                  onDelete={deleteDraft}
                />
              )}
            />
          )}
        </div>
      </div>
      <ReviewBar
        selection={summary}
        fileIndex={fileIndex}
        fileCount={files.files.length}
        pendingCount={pending.comments.length}
        hasHunks={rows.length > 0}
        onFile={stepFile}
        onHunk={(direction) => {
          const moved = diff.current?.moveToHunk(direction) ?? false;
          if (!moved && direction === 1) stepFile(1);
        }}
        onReview={() => {
          submit.open(null);
        }}
        onComment={startComment}
        onSelectRange={() => {
          if (selectionState && selection) range.open(selectionState);
        }}
        onClearSelection={() => {
          select(null);
        }}
      />
      {comment.sheet ? (
        <CommentSheet
          key={`comment:${String(comment.sheet.session)}`}
          pull={pull}
          target={comment.sheet.value}
          pending={pending}
          isOpen={comment.sheet.open}
          onOpenChange={comment.setOpen}
          onSaved={(anchor) => {
            savedDraft.current = anchor;
          }}
        />
      ) : null}
      {range.sheet?.value.commitOid === files.headOid &&
      range.sheet.value.baseOid === files.baseOid &&
      range.sheet.value.path === file.path ? (
        <SelectRangeSheet
          key={`range:${String(range.sheet.session)}`}
          rows={rows}
          selection={range.sheet.value.selection}
          isOpen={range.sheet.open}
          onOpenChange={range.setOpen}
          onSelect={select}
        />
      ) : null}
      {submit.sheet ? (
        <SubmitSheet
          key={`submit:${String(submit.sheet.session)}`}
          pull={pull}
          commitOid={files.headOid}
          baseOid={files.baseOid}
          pending={pending}
          isOpen={submit.sheet.open}
          onOpenChange={submit.setOpen}
          onShowComment={showDraft}
        />
      ) : null}
    </Page>
  );
}
