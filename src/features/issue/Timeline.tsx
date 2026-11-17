import { useCallback } from "react";
import { useTimeline, type TimelineItem } from "@/data/issues";
import type { RepoRef } from "@/data/types";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { useT } from "@/i18n/index.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { TimelineEntry } from "./TimelineEvent.tsx";
import styles from "./Conversation.module.css";

const COMMENT_ESTIMATE_PX = 180;
const EVENT_ESTIMATE_PX = 48;

type VisibleItem = Exclude<TimelineItem, { kind: "other" }>;

function isVisible(entry: TimelineItem): entry is VisibleItem {
  return entry.kind !== "other";
}

export function Timeline(props: { repo: RepoRef; number: number }) {
  const t = useT();
  const { repo, number } = props;
  const timeline = useTimeline(repo.owner, repo.name, number);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = timeline;
  const canFetchMore = hasNextPage && !isFetchingNextPage && !isFetchNextPageError;
  const loadMore = useCallback(() => {
    if (canFetchMore) void fetchNextPage();
  }, [canFetchMore, fetchNextPage]);

  if (timeline.isPending) {
    return (
      <div className={styles.timelineSkeleton} aria-busy="true">
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="100%" height="4rem" />
        <Skeleton width="45%" height="1rem" />
      </div>
    );
  }
  if (timeline.isError && !timeline.data) {
    return <ErrorState error={timeline.error} onRetry={() => void timeline.refetch()} />;
  }
  const items = timeline.data.pages.flatMap((page) => page.items).filter(isVisible);
  return (
    <>
      {items.length === 0 ? (
        <p className={styles.timelineEmpty}>{t("issue.timeline.empty")}</p>
      ) : (
        <VirtualList
          label={t("issue.timeline.label")}
          items={items}
          getKey={(entry) => entry.id}
          estimateSize={(entry) =>
            entry.kind === "comment" || entry.kind === "review"
              ? COMMENT_ESTIMATE_PX
              : EVENT_ESTIMATE_PX
          }
          renderItem={(entry) => <TimelineEntry entry={entry} repo={repo} />}
          onEndReached={loadMore}
          isComplete={!hasNextPage}
          separators
        />
      )}
      {isFetchingNextPage ? (
        <div className={styles.timelineFooter}>
          <Spinner size="small" label={t("issue.timeline.loadingMore")} />
        </div>
      ) : null}
      {isFetchNextPageError ? (
        <ErrorState error={timeline.error} onRetry={() => void fetchNextPage()} />
      ) : null}
    </>
  );
}
