import { useCallback, useState } from "react";
import { Activity, RotateCw, Tag } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import {
  useActivityFeed,
  useStarredReleases,
  useViewerSummary,
  type FeedFilter,
  type FeedGroup,
} from "@/data/home";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { estimateFeedRow, FeedRow } from "./FeedRow.tsx";
import { ProfileCard, ProfileCardSkeleton } from "./ProfileCard.tsx";
import { PullToRefresh } from "./PullToRefresh.tsx";
import { ReleaseRow, releaseKey } from "./ReleaseRow.tsx";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import styles from "./HomeScreen.module.css";

const RELEASES_PREVIEW = 10;

const FEED_FILTERS: readonly { id: FeedFilter; label: MessageKey }[] = [
  { id: "all", label: "home.feed.filter.all" },
  { id: "releases", label: "home.feed.filter.releases" },
  { id: "stars", label: "home.feed.filter.stars" },
  { id: "pushes", label: "home.feed.filter.pushes" },
  { id: "issuesAndPrs", label: "home.feed.filter.issuesAndPrs" },
  { id: "follows", label: "home.feed.filter.follows" },
];

function ReleasesSection(props: { releases: ReturnType<typeof useStarredReleases> }) {
  const t = useT();
  const { releases } = props;
  if (releases.isPending) {
    return (
      <section className={styles.section} aria-busy>
        <h2 className={styles.heading}>{t("home.releases.title")}</h2>
        <SkeletonRows />
      </section>
    );
  }
  if (releases.isError) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>{t("home.releases.title")}</h2>
        <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />
      </section>
    );
  }
  if (releases.data.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.heading}>{t("home.releases.title")}</h2>
        <EmptyState
          icon={<Tag />}
          title={t("home.releases.empty.title")}
          message={t("home.releases.empty.message")}
        />
      </section>
    );
  }
  return (
    <ListSection title={t("home.releases.title")}>
      {releases.data.slice(0, RELEASES_PREVIEW).map((release) => (
        <ReleaseRow key={releaseKey(release)} release={release} />
      ))}
      {releases.data.length > RELEASES_PREVIEW ? (
        <ListRow
          href="/dashboard/releases"
          title={<span className={styles.seeAll}>{t("home.releases.seeAll")}</span>}
          detail={String(releases.data.length)}
        />
      ) : null}
    </ListSection>
  );
}

function feedGroupKey(group: FeedGroup): string {
  return group.id;
}

function ActivitySection(props: {
  filter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
  feed: ReturnType<typeof useActivityFeed>;
}) {
  const t = useT();
  const { filter, feed } = props;
  const groups = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  let body;
  if (feed.isPending) body = <SkeletonRows />;
  else if (feed.isError && groups.length === 0) {
    body = <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;
  } else if (groups.length === 0) {
    body = (
      <EmptyState
        icon={<Activity />}
        title={t(filter === "all" ? "home.feed.empty.title" : "home.feed.emptyFilter.title")}
        message={t(filter === "all" ? "home.feed.empty.message" : "home.feed.emptyFilter.message")}
      />
    );
  } else {
    body = (
      <VirtualList
        label={t("home.feed.title")}
        items={groups}
        getKey={feedGroupKey}
        estimateSize={estimateFeedRow}
        renderItem={(group) => <FeedRow group={group} />}
        onEndReached={loadMore}
      />
    );
  }

  return (
    <section className={styles.section} aria-busy={feed.isFetching || undefined}>
      <h2 className={styles.heading}>{t("home.feed.title")}</h2>
      <div className={styles.filters}>
        <SegmentedControl
          label={t("home.feed.filter.label")}
          segments={FEED_FILTERS.map((each) => ({ id: each.id, label: t(each.label) }))}
          selected={filter}
          onChange={props.onFilterChange}
        />
      </div>
      {body}
      {isFetchingNextPage ? (
        <div className={styles.loadingMore}>
          <Spinner size="small" />
        </div>
      ) : null}
      {feed.isFetchNextPageError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.fetchNextPage()} />
      ) : null}
      {groups.length > 0 && !hasNextPage ? (
        <p className={styles.footnote}>{t("home.feed.end")}</p>
      ) : null}
      <p className={styles.footnote}>{t("home.feed.delayNote")}</p>
    </section>
  );
}

export default function HomeScreen() {
  const t = useT();
  const viewer = useViewerSummary();
  const releases = useStarredReleases();
  const [filter, setFilter] = useState<FeedFilter>("all");
  const feed = useActivityFeed(filter);
  const [refreshing, setRefreshing] = useState(false);
  const { refetch: refetchViewer } = viewer;
  const { refetch: refetchReleases } = releases;
  const { refetch: refetchFeed } = feed;
  const refresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([refetchViewer(), refetchReleases(), refetchFeed()]).finally(() => {
      setRefreshing(false);
    });
  }, [refetchViewer, refetchReleases, refetchFeed]);

  return (
    <Page
      title={t("app.tabs.home")}
      largeTitle
      menuActions={[
        {
          id: "refresh",
          label: t("home.refresh"),
          icon: <RotateCw aria-hidden />,
          onAction: refresh,
        },
      ]}
    >
      <PullToRefresh refreshing={refreshing} onRefresh={refresh}>
        {viewer.data ? (
          <ProfileCard viewer={viewer.data} />
        ) : viewer.isError ? (
          <div className={styles.cardError}>
            <ErrorState error={viewer.error} onRetry={() => void viewer.refetch()} />
          </div>
        ) : (
          <ProfileCardSkeleton />
        )}
        <ReleasesSection releases={releases} />
        <ActivitySection filter={filter} onFilterChange={setFilter} feed={feed} />
      </PullToRefresh>
    </Page>
  );
}
