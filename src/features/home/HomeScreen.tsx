import { useCallback, useState } from "react";
import { Activity, Bell, ChevronDown, ChevronRight, RotateCw, Settings, Tag } from "lucide-react";
import { Link } from "react-aria-components/Link";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Page } from "@/app/Page.tsx";
import { useShell } from "@/app/shell-context.ts";
import {
  useActivityFeed,
  useStarredReleases,
  useViewerSummary,
  type FeedFilter,
  type FeedGroup,
} from "@/data/home";
import { useActiveAccount } from "@/data/session";
import type { RepoSummary } from "@/data/types";
import { RepoRow } from "@/features/account/profile/RepoRow.tsx";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { IconButton } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { estimateFeedRow, FeedRow } from "./FeedRow.tsx";
import { ContributionGraph, ProfileIdentity } from "./ProfileCard.tsx";
import { PullToRefresh } from "./PullToRefresh.tsx";
import { ReleaseRow, releaseKey } from "./ReleaseRow.tsx";
import styles from "./HomeScreen.module.css";

const RELEASES_PREVIEW = 10;
type ActivityView = FeedFilter | "starredReleases";
const ACTIVITY_VIEWS: readonly { id: ActivityView; label: MessageKey }[] = [
  { id: "all", label: "home.feed.filter.all" },
  { id: "stars", label: "home.feed.filter.stars" },
  { id: "pushes", label: "home.feed.filter.pushes" },
  { id: "issuesAndPrs", label: "home.feed.filter.issuesAndPrs" },
  { id: "releases", label: "home.feed.filter.releases" },
  { id: "follows", label: "home.feed.filter.follows" },
  { id: "starredReleases", label: "home.releases.starred" },
];

function RecentRepositories(props: { repositories: readonly RepoSummary[] }) {
  const t = useT();
  return (
    <section className={styles.recent} aria-label={t("home.repositories.title")}>
      <div className={styles.sectionHeader}>
        <h2>{t("home.repositories.title")}</h2>
        <Link className={moduleClass(styles.seeAll)} href="/repositories">
          {t("home.repositories.seeAll")} <ChevronRight aria-hidden />
        </Link>
      </div>
      {props.repositories.length > 0 ? (
        <ul className={styles.rail} aria-label={t("home.repositories.title")}>
          {props.repositories.map((repo) => (
            <li key={repo.name}>
              <RepoRow repo={repo} showOwner={false} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>{t("home.repositories.empty")}</p>
      )}
    </section>
  );
}

function ReleasesSection(props: { releases: ReturnType<typeof useStarredReleases> }) {
  const t = useT();
  const { releases } = props;
  if (releases.isPending) return <SkeletonRows />;
  if (releases.isLoadingError) {
    return <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />;
  }
  if (!releases.data.length) {
    return (
      <EmptyState
        icon={<Tag />}
        title={t("home.releases.empty.title")}
        message={t("home.releases.empty.message")}
      />
    );
  }
  return (
    <ListSection title={t("home.releases.title")} footer={t("home.releases.footnote")}>
      {releases.data.slice(0, RELEASES_PREVIEW).map((release) => (
        <ReleaseRow key={releaseKey(release)} release={release} />
      ))}
      {releases.data.length > RELEASES_PREVIEW ? (
        <ListRow href="/dashboard/releases" title={t("home.releases.seeAll")} />
      ) : null}
    </ListSection>
  );
}

function feedGroupKey(group: FeedGroup): string {
  return group.id;
}

function Feed(props: { filter: FeedFilter; feed: ReturnType<typeof useActivityFeed> }) {
  const t = useT();
  const { filter, feed } = props;
  const groups = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = feed;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  if (feed.isPending) return <SkeletonRows />;
  if (feed.isError && groups.length === 0) {
    return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;
  }
  return (
    <>
      {feed.isRefetchError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
      ) : null}
      {groups.length > 0 ? (
        <div className={styles.timeline}>
          <VirtualList
            label={t("home.feed.title")}
            items={groups}
            getKey={feedGroupKey}
            estimateSize={estimateFeedRow}
            renderItem={(group) => <FeedRow group={group} />}
            isComplete={!hasNextPage}
            onEndReached={loadMore}
          />
        </div>
      ) : (
        <EmptyState
          icon={<Activity />}
          title={t(filter === "all" ? "home.feed.empty.title" : "home.feed.emptyFilter.title")}
          message={t(
            filter === "all" ? "home.feed.empty.message" : "home.feed.emptyFilter.message",
          )}
        />
      )}
      {hasNextPage && !isFetchingNextPage && !isFetchNextPageError && groups.length === 0 ? (
        <button type="button" className={styles.more} onClick={loadMore}>
          {t("home.feed.older")}
        </button>
      ) : null}
      {isFetchingNextPage ? (
        <div className={styles.loadingMore}>
          <Spinner size="small" />
        </div>
      ) : null}
      {isFetchNextPageError ? (
        <ErrorState error={feed.error} onRetry={() => void feed.fetchNextPage()} />
      ) : null}
      <p className={styles.note}>
        {groups.length > 0 && !hasNextPage ? t("home.feed.end") + " " : null}
        {t("home.feed.delayNote")}
      </p>
    </>
  );
}

export default function HomeScreen() {
  const t = useT();
  const account = useActiveAccount();
  const { unreadCount } = useShell();
  const viewer = useViewerSummary();
  const [section, setSection] = useState<"activity" | "overview">("activity");
  const [view, setView] = useState<ActivityView>("all");
  const releases = useStarredReleases(section === "activity" && view === "starredReleases");
  const filter = view === "starredReleases" ? "all" : view;
  const feed = useActivityFeed(filter);
  const [refreshing, setRefreshing] = useState(false);
  const { refetch: refetchViewer } = viewer;
  const { refetch: refetchReleases } = releases;
  const { refetch: refetchFeed } = feed;
  const refresh = useCallback(() => {
    setRefreshing(true);
    const refreshContent =
      section === "overview"
        ? refetchViewer
        : view === "starredReleases"
          ? refetchReleases
          : refetchFeed;
    void refreshContent().finally(() => {
      setRefreshing(false);
    });
  }, [section, view, refetchViewer, refetchReleases, refetchFeed]);

  const notifications = t("app.tabs.inbox");
  const unread = unreadCount ?? 0;
  const profile = viewer.data ?? account;
  return (
    <Page
      title={t("app.tabs.home")}
      headingContent={<ProfileIdentity login={profile.login} name={viewer.data?.name ?? null} />}
      actions={
        <>
          <Link
            href="/notifications"
            className={moduleClass(styles.action)}
            aria-label={
              unread > 0
                ? t("app.tabs.inboxUnread", { label: notifications, count: unread })
                : notifications
            }
          >
            <Bell aria-hidden />
            {unread > 0 ? <span className={styles.unread} aria-hidden /> : null}
          </Link>
          <Link
            href="/settings"
            aria-label={t("app.settings.root")}
            className={moduleClass(styles.action)}
          >
            <Settings aria-hidden />
          </Link>
        </>
      }
    >
      <SegmentedControl
        appearance="underline"
        label={t("app.tabs.home")}
        columns={2}
        selected={section}
        segments={[
          { id: "activity", label: t("home.following") },
          { id: "overview", label: t("home.overview") },
        ]}
        onChange={setSection}
      />
      <PullToRefresh refreshing={refreshing} onRefresh={refresh}>
        {section === "overview" ? (
          <>
            {viewer.data ? (
              <>
                {viewer.isRefetchError ? (
                  <ErrorState error={viewer.error} onRetry={() => void viewer.refetch()} />
                ) : null}
                <ContributionGraph contributions={viewer.data.contributions} />
                {viewer.data.recentRepositories ? (
                  <RecentRepositories repositories={viewer.data.recentRepositories} />
                ) : null}
              </>
            ) : viewer.isError ? (
              <ErrorState error={viewer.error} onRetry={() => void viewer.refetch()} />
            ) : (
              <div className={styles.loading} aria-busy>
                <Skeleton width="100%" height="10rem" />
              </div>
            )}
            <div className={styles.overviewRefresh}>
              <IconButton label={t("home.refresh")} onPress={refresh} isPending={refreshing}>
                <RotateCw aria-hidden />
              </IconButton>
            </div>
          </>
        ) : (
          <section className={styles.activity}>
            <div className={styles.sectionHeader}>
              <h2>{t("home.feed.title")}</h2>
              <div className={styles.controls}>
                <label className={styles.filter}>
                  <span aria-hidden>
                    {t(
                      ACTIVITY_VIEWS.find((choice) => choice.id === view)?.label ??
                        "home.feed.filter.all",
                    )}
                  </span>
                  <ChevronDown aria-hidden />
                  <select
                    aria-label={t("home.feed.filter.label")}
                    value={view}
                    onChange={(event) => {
                      const choice = ACTIVITY_VIEWS.find(
                        (entry) => entry.id === event.target.value,
                      );
                      if (choice) setView(choice.id);
                    }}
                  >
                    {ACTIVITY_VIEWS.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {t(entry.label)}
                      </option>
                    ))}
                  </select>
                </label>
                <IconButton label={t("home.refresh")} onPress={refresh} isPending={refreshing}>
                  <RotateCw aria-hidden />
                </IconButton>
              </div>
            </div>
            {view === "starredReleases" ? (
              <>
                {releases.isRefetchError ? (
                  <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />
                ) : null}
                <ReleasesSection releases={releases} />
              </>
            ) : (
              <Feed filter={filter} feed={feed} />
            )}
          </section>
        )}
      </PullToRefresh>
    </Page>
  );
}
