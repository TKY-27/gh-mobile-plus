import { useCallback, useState } from "react";
import { CheckCheck, Inbox, Layers, List, MessageCircleOff } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import {
  useBulkThreadAction,
  useInbox,
  useThreadAction,
  useUnsubscribeThread,
  type InboxFilter,
  type InboxThread,
} from "@/data/inbox";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { describeError, ErrorState } from "@/ui/ErrorState.tsx";
import { useNow } from "@/ui/RelativeTime.tsx";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { dismissToast, showToast } from "@/ui/Toast.tsx";
import { showErrorToast } from "@/ui/error-toast.ts";
import { useIsOffline } from "@/data/status";
import { BulkBar, type BulkRun } from "./BulkBar.tsx";
import { InboxRow, THREAD_ROW_ESTIMATE_PX } from "./InboxRow.tsx";
import type { SwipeAction } from "./swipe.ts";
import { ThreadActionsSheet } from "./ThreadActionsSheet.tsx";
import styles from "./InboxScreen.module.css";

const HEADER_ROW_ESTIMATE_PX = 44;
const SKELETON_ROWS = 8;

const FILTERS: readonly { id: InboxFilter; label: MessageKey }[] = [
  { id: "unread", label: "inbox.filter.unread" },
  { id: "participating", label: "inbox.filter.participating" },
  { id: "all", label: "inbox.filter.all" },
];

type Entry =
  | { kind: "header"; key: string; repo: string; count: number }
  | { kind: "thread"; key: string; thread: InboxThread };

function toEntries(threads: readonly InboxThread[], grouped: boolean): Entry[] {
  const asEntry = (thread: InboxThread): Entry => ({ kind: "thread", key: thread.id, thread });
  if (!grouped) return threads.map(asEntry);
  const byRepo = new Map<string, InboxThread[]>();
  for (const thread of threads) {
    const repo = `${thread.repo.owner}/${thread.repo.name}`;
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), thread]);
  }
  return [...byRepo].flatMap(([repo, members]) => [
    { kind: "header" as const, key: `repo:${repo}`, repo, count: members.length },
    ...members.map(asEntry),
  ]);
}

function entryKey(entry: Entry): string {
  return entry.key;
}

function estimateEntry(entry: Entry): number {
  return entry.kind === "header" ? HEADER_ROW_ESTIMATE_PX : THREAD_ROW_ESTIMATE_PX;
}

function EmptyInbox(props: { filter: InboxFilter; onShowAll: () => void }) {
  const t = useT();
  if (props.filter === "unread") {
    return (
      <EmptyState
        icon={<CheckCheck />}
        title={t("inbox.empty.unread.title")}
        message={t("inbox.empty.unread.message")}
        action={<Button onPress={props.onShowAll}>{t("inbox.empty.showAll")}</Button>}
      />
    );
  }
  if (props.filter === "participating") {
    return (
      <EmptyState
        icon={<MessageCircleOff />}
        title={t("inbox.empty.participating.title")}
        message={t("inbox.empty.participating.message")}
        action={<Button onPress={props.onShowAll}>{t("inbox.empty.showAll")}</Button>}
      />
    );
  }
  return (
    <EmptyState
      icon={<Inbox />}
      title={t("inbox.empty.all.title")}
      message={t("inbox.empty.all.message")}
    />
  );
}

export default function InboxScreen() {
  const t = useT();
  const formatters = useFormatters();
  const router = useRouter();
  const now = useNow();
  const offline = useIsOffline();
  const [filter, setFilter] = useState<InboxFilter>("unread");
  const [grouped, setGrouped] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
  const [outcome, setOutcome] = useState<BulkRun | null>(null);
  const [bulkAction, setBulkAction] = useState<SwipeAction>("done");
  const [actionsFor, setActionsFor] = useState<{ thread: InboxThread; open: boolean } | null>(null);
  const inbox = useInbox(filter);
  const threadAction = useThreadAction();
  const unsubscribe = useUnsubscribeThread();
  const bulk = useBulkThreadAction();
  const threads = inbox.data?.pages.flatMap((page) => page.items) ?? [];
  // Keep only unread threads eligible for retry.
  const selectedThreads = selection
    ? threads.filter(
        (thread) => selection.has(thread.id) && (outcome?.action !== "read" || thread.unread),
      )
    : [];
  const selectedIds = new Set(selectedThreads.map((thread) => thread.id));
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = inbox;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const reasonOf = (error: unknown) => describeError(t, formatters, error, now).title;

  const perform = (action: SwipeAction, thread: InboxThread, undoable: boolean) => {
    let undoToast: number | null = null;
    // GitHub cannot undo a sent write.
    const pendingAction = threadAction(action, thread.id, {
      immediate: !undoable,
      onSend: () => {
        if (undoToast !== null) dismissToast(undoToast);
      },
    });
    if (undoable) {
      undoToast = showToast(t(action === "done" ? "inbox.toast.done" : "inbox.toast.read"), {
        timeoutMs: "request",
        action: {
          label: t("common.undo"),
          onAction: () => {
            pendingAction.undo();
          },
        },
      });
    }
    pendingAction.settled.then(
      () => {
        if (undoToast !== null) dismissToast(undoToast);
      },
      (error: unknown) => {
        if (undoToast !== null) dismissToast(undoToast);
        showErrorToast(
          t,
          error,
          t(action === "done" ? "inbox.toast.doneFailed" : "inbox.toast.readFailed", {
            reason: reasonOf(error),
          }),
          () => {
            perform(action, thread, undoable);
          },
        );
      },
    );
  };

  const open = (thread: InboxThread) => {
    if (thread.appPath) router.history.push(thread.appPath);
    else setActionsFor({ thread: { ...thread, unread: offline && thread.unread }, open: true });
    if (!offline && thread.unread) perform("read", thread, false);
  };

  const unsubscribeFrom = (thread: InboxThread) => {
    unsubscribe.mutate(
      { threadId: thread.id },
      {
        onSuccess: () => showToast(t("inbox.toast.unsubscribed")),
        onError: (error) => {
          showErrorToast(
            t,
            error,
            t("inbox.toast.unsubscribeFailed", { reason: reasonOf(error) }),
            () => {
              unsubscribeFrom(thread);
            },
          );
        },
      },
    );
  };

  const runBulk = (action: SwipeAction) => {
    const ids = selectedThreads.map((thread) => thread.id);
    if (ids.length === 0) return;
    setSelection(new Set(ids));
    setBulkAction(action);
    setOutcome(null);
    bulk.run(action, ids).then(
      (progress) => {
        for (const restriction of progress.restrictions) {
          showErrorToast(t, restriction, t("inbox.bulk.failed", { reason: reasonOf(restriction) }));
        }
        if (progress.failed === 0 && !progress.stoppedByRateLimit) {
          setSelection(null);
          showToast(
            t(action === "done" ? "inbox.bulk.doneAll" : "inbox.bulk.readAll", {
              count: progress.done,
            }),
          );
        } else setOutcome({ action, progress });
      },
      (error: unknown) => {
        showErrorToast(t, error, t("inbox.bulk.failed", { reason: reasonOf(error) }), () => {
          runBulk(action);
        });
      },
    );
  };

  const changeFilter = (next: InboxFilter) => {
    setFilter(next);
    setSelection(null);
    setOutcome(null);
  };

  const selecting = selection !== null;
  const running = bulk.progress?.running ?? false;
  const entries = toEntries(threads, grouped);

  let body;
  if (inbox.isPending) body = <SkeletonRows rows={SKELETON_ROWS} />;
  else if (inbox.isError && threads.length === 0) {
    body = <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />;
  } else if (threads.length === 0) {
    body = (
      <EmptyInbox
        filter={filter}
        onShowAll={() => {
          changeFilter("all");
        }}
      />
    );
  } else {
    body = (
      <VirtualList
        label={t("inbox.listLabel")}
        items={entries}
        getKey={entryKey}
        estimateSize={estimateEntry}
        onEndReached={loadMore}
        renderItem={(entry) =>
          entry.kind === "header" ? (
            <h2 className={styles.groupHeader}>
              <span className={styles.groupName}>{entry.repo}</span>
              <span className={styles.groupCount}>{formatters.number(entry.count)}</span>
            </h2>
          ) : (
            <InboxRow
              thread={entry.thread}
              selecting={selecting}
              offline={offline}
              selected={selectedIds.has(entry.thread.id)}
              removesOnRead={filter === "unread"}
              onSelectedChange={(selected) => {
                const next = new Set(selectedIds);
                if (selected) next.add(entry.thread.id);
                else next.delete(entry.thread.id);
                setSelection(next);
              }}
              onOpen={() => {
                open(entry.thread);
              }}
              onAction={(action) => {
                perform(action, entry.thread, true);
              }}
              onShowActions={() => {
                setActionsFor({ thread: entry.thread, open: true });
              }}
            />
          )
        }
      />
    );
  }

  return (
    <Page
      title={t("inbox.listLabel")}
      largeTitle
      openOnGitHub
      actions={
        threads.length > 0 || selecting ? (
          <Button
            variant="plain"
            isDisabled={running || (offline && !selecting)}
            onPress={() => {
              setSelection(selecting ? null : new Set());
              setOutcome(null);
            }}
          >
            {t(selecting ? "common.cancel" : "inbox.select")}
          </Button>
        ) : null
      }
      menuActions={[
        {
          id: "group",
          label: t(grouped ? "inbox.ungroup" : "inbox.groupByRepository"),
          icon: grouped ? <List aria-hidden /> : <Layers aria-hidden />,
          onAction: () => {
            setGrouped(!grouped);
          },
        },
      ]}
    >
      <div className={styles.filters}>
        <SegmentedControl
          label={t("inbox.filter.label")}
          segments={FILTERS.map((each) => ({ id: each.id, label: t(each.label) }))}
          selected={filter}
          onChange={changeFilter}
        />
      </div>
      {selecting ? (
        <div className={styles.selectionHeader}>
          <Button
            variant="plain"
            isDisabled={running || threads.length === 0}
            onPress={() => {
              setSelection(
                selectedThreads.length === threads.length
                  ? new Set()
                  : new Set(threads.map((thread) => thread.id)),
              );
            }}
          >
            {t(selectedThreads.length === threads.length ? "inbox.deselectAll" : "inbox.selectAll")}
          </Button>
        </div>
      ) : null}
      <div className={styles.threads} aria-busy={inbox.isFetching || undefined}>
        {body}
      </div>
      {isFetchingNextPage ? (
        <div className={styles.loadingMore}>
          <Spinner size="small" />
        </div>
      ) : null}
      {inbox.isFetchNextPageError ? (
        <ErrorState error={inbox.error} onRetry={() => void inbox.fetchNextPage()} />
      ) : null}
      {selecting ? (
        <BulkBar
          selectedCount={selectedThreads.length}
          offline={offline}
          run={bulk.progress?.running ? { action: bulkAction, progress: bulk.progress } : outcome}
          onRun={runBulk}
        />
      ) : null}
      <ThreadActionsSheet
        thread={actionsFor?.thread ?? null}
        isOpen={actionsFor?.open ?? false}
        onClose={() => {
          setActionsFor((current) => (current ? { ...current, open: false } : null));
        }}
        onAction={(thread, action) => {
          perform(action, thread, true);
        }}
        onUnsubscribe={unsubscribeFrom}
        offline={offline}
      />
    </Page>
  );
}
