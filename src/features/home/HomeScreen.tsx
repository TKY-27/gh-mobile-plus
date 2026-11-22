import { useCallback, useRef, useState, type Ref } from "react";
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDot,
  GitPullRequest,
  GitPullRequestArrow,
  RotateCw,
  Settings,
  Tag,
} from "lucide-react";
import { Link } from "react-aria-components/Link";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Page } from "@/app/Page.tsx";
import { useScreen } from "@/app/navigation/screen.ts";
import { useShell } from "@/app/shell-context.ts";
import {
  useActivityFeed,
  useStarredReleases,
  useViewerSummary,
  type FeedFilter,
  type FeedGroup,
} from "@/data/home";
import { useActiveAccount } from "@/data/session";
import { useWorkQueue, type WorkSegment } from "@/data/work";
import type { RepoSummary } from "@/data/types";
import { RepoRow } from "@/features/account/profile/RepoRow.tsx";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
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
const RECENT_REPOSITORIES_PREVIEW = 2;
const WORK_SHORTCUTS: readonly {
  id: WorkSegment;
  label: MessageKey;
  icon: typeof GitPullRequest;
}[] = [
  { id: "myPrs", label: "work.segment.myPrs", icon: GitPullRequest },
  { id: "reviewRequested", label: "work.segment.reviewRequested", icon: GitPullRequestArrow },
  { id: "assigned", label: "work.segment.assigned", icon: CircleDot },
  { id: "ciFailing", label: "work.segment.ciFailing", icon: CircleAlert },
];
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
        <ul className={styles.repositoryGrid} aria-label={t("home.repositories.title")}>
          {props.repositories.slice(0, RECENT_REPOSITORIES_PREVIEW).map((repo) => (
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

function WorkSummary(props: { queue: ReturnType<typeof useWorkQueue> }) {
  const t = useT();
  const formatters = useFormatters();
  const { queue } = props;
  return (
    <section className={styles.work} aria-label={t("home.work.title")}>
      <div className={styles.sectionHeader}>
        <h2>{t("home.work.title")}</h2>
      </div>
      {queue.isError ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : null}
      <div className={styles.workGrid} aria-busy={queue.isPending || undefined}>
        {WORK_SHORTCUTS.map(({ id, label, icon: Icon }) => {
          const count = queue.data?.[id].count;
          if (count === undefined) {
            return queue.isPending ? (
              <div key={id} className={styles.workTile} aria-hidden>
                <Skeleton width="2rem" height="2rem" />
                <Skeleton width="70%" height="1rem" />
              </div>
            ) : null;
          }
          return (
            <Link
              key={id}
              href={`/pulls?segment=${id}`}
              className={moduleClass(styles.workTile)}
              data-failing={(id === "ciFailing" && count > 0) || undefined}
            >
              <span className={styles.workCount}>{formatters.number(count)}</span>
              <Icon className={styles.workIcon} aria-hidden />
              <span className={styles.workLabel}>{t(label)}</span>
            </Link>
          );
        })}
      </div>
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

function FollowingSection({
  view,
  onViewChange,
  unread,
  ref,
}: {
  view: ActivityView;
  onViewChange: (next: ActivityView) => void;
  unread: number;
  ref: Ref<HTMLHeadingElement>;
}) {
  const t = useT();
  const formatters = useFormatters();
  const releases = useStarredReleases(view === "starredReleases");
  const filter = view === "starredReleases" ? "all" : view;
  const feed = useActivityFeed(filter);
  const [refreshing, setRefreshing] = useState(false);
  const { refetch: refetchReleases } = releases;
  const { refetch: refetchFeed } = feed;
  const refresh = useCallback(() => {
    setRefreshing(true);
    const refreshed = view === "starredReleases" ? refetchReleases() : refetchFeed();
    void refreshed.finally(() => {
      setRefreshing(false);
    });
  }, [view, refetchReleases, refetchFeed]);

  return (
    <PullToRefresh refreshing={refreshing} onRefresh={refresh}>
      <section className={styles.activity}>
        <Link href="/notifications" className={moduleClass(styles.notificationsLink)}>
          <Bell aria-hidden />
          <span>{t("home.notifications.open")}</span>
          {unread > 0 ? (
            <span className={styles.notificationCount}>{formatters.number(unread)}</span>
          ) : null}
          <ChevronRight aria-hidden />
        </Link>
        <div className={styles.sectionHeader}>
          <h2 ref={ref} tabIndex={-1}>
            {t("home.feed.title")}
          </h2>
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
                  const choice = ACTIVITY_VIEWS.find((entry) => entry.id === event.target.value);
                  if (choice) onViewChange(choice.id);
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
    </PullToRefresh>
  );
}

export default function HomeScreen() {
  const t = useT();
  const account = useActiveAccount();
  const { scroller } = useScreen();
  const activityHeading = useRef<HTMLHeadingElement | null>(null);
  const { unreadCount } = useShell();
  const viewer = useViewerSummary();
  const work = useWorkQueue();
  const [section, setSection] = useState<"activity" | "overview">("overview");
  const changeSection = (next: "activity" | "overview") => {
    setSection(next);
    scroller.current?.scrollTo({ top: 0 });
  };
  const [view, setView] = useState<ActivityView>("all");
  const [refreshing, setRefreshing] = useState(false);
  const { refetch: refetchViewer } = viewer;
  const { refetch: refetchWork } = work;
  const refresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([refetchViewer(), refetchWork()]).finally(() => {
      setRefreshing(false);
    });
  }, [refetchViewer, refetchWork]);

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
          { id: "overview", label: t("home.overview") },
          { id: "activity", label: t("home.following") },
        ]}
        onChange={changeSection}
      />
      {section === "overview" ? (
        <PullToRefresh refreshing={refreshing} onRefresh={refresh}>
          <div className={styles.overview}>
            {viewer.data ? (
              <>
                {viewer.isRefetchError ? (
                  <ErrorState error={viewer.error} onRetry={() => void viewer.refetch()} />
                ) : null}
                <ContributionGraph contributions={viewer.data.contributions} />
              </>
            ) : viewer.isError ? (
              <ErrorState error={viewer.error} onRetry={() => void viewer.refetch()} />
            ) : (
              <div className={styles.loading} aria-busy>
                <Skeleton width="100%" height="10rem" />
              </div>
            )}
            <WorkSummary queue={work} />
            {viewer.data?.recentRepositories ? (
              <RecentRepositories repositories={viewer.data.recentRepositories} />
            ) : null}
            <button
              type="button"
              className={styles.followingLink}
              onClick={() => {
                changeSection("activity");
                requestAnimationFrame(() =>
                  activityHeading.current?.focus({ preventScroll: true }),
                );
              }}
            >
              <Activity aria-hidden />
              <span>{t("home.following.open")}</span>
              <ChevronRight aria-hidden />
            </button>
            <div className={styles.overviewRefresh}>
              <IconButton label={t("home.refresh")} onPress={refresh} isPending={refreshing}>
                <RotateCw aria-hidden />
              </IconButton>
            </div>
          </div>
        </PullToRefresh>
      ) : (
        <FollowingSection
          view={view}
          onViewChange={setView}
          unread={unread}
          ref={activityHeading}
        />
      )}
    </Page>
  );
}
