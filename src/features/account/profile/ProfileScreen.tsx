import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { openExternal } from "@/ui/external.ts";
import {
  Plus,
  ExternalLink,
  FolderGit2,
  Star,
  Users,
  ArrowDownWideNarrow,
  Check,
  ChevronDown,
} from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { Link } from "react-aria-components/Link";
import { Page } from "@/app/Page.tsx";
import { useScreenParams, useScreenSearch } from "@/app/navigation/screen.ts";
import { ownerRoute } from "@/app/router.ts";
import { useActiveAccount } from "@/data/session";
import { useIsOffline } from "@/data/status";
import type { Actor, Page as ResultPage, RepoSummary } from "@/data/types";
import {
  useOrganizationMembers,
  useProfileConnections,
  useRepositoriesOf,
  type RepositorySort,
  type StarredSort,
} from "@/data/users";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { Menu } from "@/ui/Menu.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { SearchField } from "@/ui/SearchField.tsx";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { SearchResults } from "@/features/search/SearchResults.tsx";
import { InfiniteList, VirtualList } from "@/ui/VirtualList.tsx";
import { ProfileView } from "./ProfileView.tsx";
import { REPO_ROW_ESTIMATE_PX, RepoRow } from "./RepoRow.tsx";
import styles from "./Profile.module.css";

const MEMBER_ROW_ESTIMATE_PX = 56;
const MEMBER_AVATAR_PX = 32;

const FILTER_DELAY_MS = 300;

const OWNED_SORTS: readonly {
  id: RepositorySort;
  labelKey:
    | "account.repositories.updatedOrder"
    | "account.repositories.pushedOrder"
    | "account.repositories.starsOrder"
    | "account.repositories.nameOrder"
    | "account.repositories.createdOrder";
}[] = [
  { id: "updated", labelKey: "account.repositories.updatedOrder" },
  { id: "pushed", labelKey: "account.repositories.pushedOrder" },
  { id: "stars", labelKey: "account.repositories.starsOrder" },
  { id: "name", labelKey: "account.repositories.nameOrder" },
  { id: "created", labelKey: "account.repositories.createdOrder" },
];

const STARRED_SORTS: readonly {
  id: StarredSort;
  labelKey: "account.starred.order" | "account.starred.oldestOrder";
}[] = [
  { id: "newest", labelKey: "account.starred.order" },
  { id: "oldest", labelKey: "account.starred.oldestOrder" },
];

function RepositoryList(props: {
  login: string;
  kind: "owned" | "starred";
  title: string;
  offlineFilter?: string;
}) {
  const t = useT();
  const owned = props.kind === "owned";
  const [ownedSort, setOwnedSort] = useState<RepositorySort>("updated");
  const [starredSort, setStarredSort] = useState<StarredSort>("newest");
  const activeSort = owned ? ownedSort : starredSort;
  const query = useRepositoriesOf(props.login, props.kind, activeSort);
  const rows = {
    label: props.title,
    estimateSize: REPO_ROW_ESTIMATE_PX,
    getKey: (repo: RepoSummary) => `${repo.owner}/${repo.name}`,
    renderItem: (repo: RepoSummary) => <RepoRow repo={repo} showOwner={!owned} />,
  };
  const empty = (
    <EmptyState
      icon={owned ? <FolderGit2 /> : <Star />}
      title={t(owned ? "account.repositories.empty" : "account.starred.empty")}
      message={t(owned ? "account.repositories.emptyMessage" : "account.starred.emptyMessage", {
        owner: props.login,
      })}
    />
  );
  if (props.offlineFilter !== undefined) {
    const pages = query.data?.pages;
    if (!pages?.length)
      return (
        <EmptyState
          icon={<FolderGit2 />}
          title={t("account.repositories.notSaved")}
          message={t("account.repositories.reconnect")}
        />
      );
    const term = props.offlineFilter.toLowerCase();
    const matches = pages.flatMap((page) =>
      page.items.filter((repo) => repo.name.toLowerCase().includes(term)),
    );
    if (!matches.length) {
      if (!term && !query.hasNextPage) return empty;
      return (
        <EmptyState
          icon={<FolderGit2 />}
          title={t(
            query.hasNextPage ? "account.repositories.noSavedMatch" : "search.noResults.title",
            { query: props.offlineFilter },
          )}
          message={t(
            query.hasNextPage
              ? "account.repositories.reconnect"
              : "account.repositories.changeFilter",
          )}
        />
      );
    }
    return (
      <>
        {query.hasNextPage ? (
          <p className={styles.listOrder} role="status">
            {t("account.repositories.savedOnly")}
          </p>
        ) : null}
        <VirtualList {...rows} items={matches} isComplete={!query.hasNextPage} separators />
      </>
    );
  }
  const sortActions = owned
    ? OWNED_SORTS.map((option) => ({
        id: option.id,
        label: t(option.labelKey),
        ...(ownedSort === option.id ? { icon: <Check aria-hidden /> } : {}),
        onAction: () => {
          setOwnedSort(option.id);
        },
      }))
    : STARRED_SORTS.map((option) => ({
        id: option.id,
        label: t(option.labelKey),
        ...(starredSort === option.id ? { icon: <Check aria-hidden /> } : {}),
        onAction: () => {
          setStarredSort(option.id);
        },
      }));
  const activeSortLabel = owned
    ? t(
        OWNED_SORTS.find((option) => option.id === ownedSort)?.labelKey ??
          "account.repositories.updatedOrder",
      )
    : t(
        STARRED_SORTS.find((option) => option.id === starredSort)?.labelKey ??
          "account.starred.order",
      );
  return (
    <>
      <div className={styles.listOrderBar}>
        <Menu
          label={t(owned ? "account.repositories.sortLabel" : "account.starred.sortLabel")}
          placement="bottom start"
          actions={sortActions}
        >
          <AriaButton className={moduleClass(styles.listOrderButton)}>
            <ArrowDownWideNarrow aria-hidden />
            <span>{activeSortLabel}</span>
            <ChevronDown aria-hidden />
          </AriaButton>
        </Menu>
      </div>
      <InfiniteList {...rows} query={query} empty={empty} />
    </>
  );
}

export function MyRepositoriesScreen() {
  const t = useT();
  const account = useActiveAccount();
  const offline = useIsOffline();
  const [filter, setFilter] = useState("");
  const [submitted, setSubmitted] = useState("");
  const typed = filter.trim();
  useEffect(() => {
    if (offline || !typed || typed === submitted) return;
    const timer = window.setTimeout(() => {
      setSubmitted(typed);
    }, FILTER_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [offline, typed, submitted]);
  const title = t("account.lists.repositories");
  return (
    <Page
      title={title}
      largeTitle
      actions={
        <Link
          href="/new"
          aria-label={t("repo.create.title")}
          className={moduleClass(styles.createRepo)}
        >
          <Plus aria-hidden />
        </Link>
      }
    >
      <div className={styles.browserHead}>
        <div className={styles.ownerLine}>
          <Link href={`/${account.login}`} className={moduleClass(styles.ownerLink)}>
            <Avatar src={account.avatarUrl} name={account.login} size={MEMBER_AVATAR_PX} />@
            {account.login}
          </Link>
          <Link href={`/${account.login}?tab=stars`} className={moduleClass(styles.starLink)}>
            <Star aria-hidden /> {t("account.lists.starred")}
          </Link>
        </div>
        <SearchField
          label={t("account.repositories.find")}
          placeholder={t("account.repositories.find")}
          value={filter}
          onChange={setFilter}
          onSubmit={(value) => {
            setSubmitted(value.trim());
          }}
        />
      </div>
      {!typed ? (
        <RepositoryList
          login={account.login}
          kind="owned"
          title={title}
          {...(offline && { offlineFilter: "" })}
        />
      ) : offline || typed === submitted ? (
        <SearchResults
          scope="repositories"
          query={`user:${account.login} fork:true in:name ${JSON.stringify(typed)}`}
          defaultSort="updated"
          displayQuery={typed}
          offlineFallback={
            offline ? (
              <RepositoryList
                login={account.login}
                kind="owned"
                title={title}
                offlineFilter={typed}
              />
            ) : null
          }
        />
      ) : (
        <SkeletonRows rows={3} />
      )}
    </Page>
  );
}

function RepositoriesScreen(props: { login: string; kind: "owned" | "starred" }) {
  const t = useT();
  const title = t(props.kind === "owned" ? "account.repositories.title" : "account.starred.title", {
    owner: props.login,
  });
  return (
    <Page title={title}>
      <RepositoryList {...props} title={title} />
    </Page>
  );
}

function MembersScreen(props: { org: string }) {
  const t = useT();
  const query = useOrganizationMembers(props.org);
  const title = t("account.members.title", { org: props.org });
  return (
    <Page
      title={title}
      openOnGitHub={false}
      menuActions={[
        {
          id: "open-on-github",
          label: t("common.openOnGitHub"),
          icon: <ExternalLink aria-hidden />,
          onAction: () => {
            openExternal(`https://github.com/orgs/${encodeURIComponent(props.org)}/people`);
          },
        },
      ]}
    >
      <PeopleList
        query={query}
        title={title}
        empty={t("account.members.empty")}
        hint={t("account.members.emptyMessage")}
      />
    </Page>
  );
}

function ConnectionsScreen(props: { login: string; kind: "followers" | "following" }) {
  const t = useT();
  const query = useProfileConnections(props.login, props.kind);
  const title = t(`account.lists.${props.kind}`);
  return (
    <Page title={title}>
      <PeopleList
        query={query}
        title={title}
        empty={t(`account.${props.kind}.empty`)}
        hint={t(`account.${props.kind}.hint`, { login: props.login })}
      />
    </Page>
  );
}

function PeopleList(props: {
  query: UseInfiniteQueryResult<InfiniteData<ResultPage<Actor>>>;
  title: string;
  empty: string;
  hint: string;
}) {
  const t = useT();
  if (!props.query.data && props.query.fetchStatus === "paused") {
    return (
      <EmptyState
        icon={<Users />}
        title={t("account.lists.notSaved")}
        message={t("account.lists.reconnect")}
      />
    );
  }
  return (
    <InfiniteList
      query={props.query}
      label={props.title}
      estimateSize={MEMBER_ROW_ESTIMATE_PX}
      getKey={(member) => member.login}
      renderItem={(member) => (
        <Link href={`/${member.login}`} className={moduleClass(styles.member)}>
          <Avatar src={member.avatarUrl} name={member.login} size={MEMBER_AVATAR_PX} />
          <span className={styles.repoName}>{member.login}</span>
        </Link>
      )}
      empty={<EmptyState icon={<Users />} title={props.empty} message={props.hint} />}
    />
  );
}

export default function ProfileScreen() {
  const { owner } = useScreenParams(ownerRoute);
  const search: Readonly<Record<string, unknown>> = useScreenSearch(ownerRoute);
  if (search.tab === "repositories") return <RepositoriesScreen login={owner} kind="owned" />;
  if (search.tab === "stars") return <RepositoriesScreen login={owner} kind="starred" />;
  if (search.tab === "followers" || search.tab === "following")
    return <ConnectionsScreen login={owner} kind={search.tab} />;
  if (search.tab === "members") return <MembersScreen org={owner} />;
  return (
    <Page title={owner}>
      <ProfileView login={owner} />
    </Page>
  );
}
