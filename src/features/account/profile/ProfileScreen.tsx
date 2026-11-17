import { openExternal } from "@/ui/external.ts";
import { ExternalLink, FolderGit2, Star, Users } from "lucide-react";
import { Link } from "react-aria-components/Link";
import { Page } from "@/app/Page.tsx";
import { useScreenParams, useScreenSearch } from "@/app/navigation/screen.ts";
import { ownerRoute } from "@/app/router.ts";
import { useOrganizationMembers, useRepositoriesOf } from "@/data/users";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { InfiniteList } from "@/ui/VirtualList.tsx";
import { ProfileView } from "./ProfileView.tsx";
import { REPO_ROW_ESTIMATE_PX, RepoRow } from "./RepoRow.tsx";
import styles from "./Profile.module.css";

const MEMBER_ROW_ESTIMATE_PX = 56;
const MEMBER_AVATAR_PX = 32;

function RepositoriesScreen(props: { login: string; kind: "owned" | "starred" }) {
  const t = useT();
  const query = useRepositoriesOf(props.login, props.kind);
  const owned = props.kind === "owned";
  const title = t(owned ? "account.repositories.title" : "account.starred.title", {
    owner: props.login,
  });
  return (
    <Page title={title}>
      <InfiniteList
        query={query}
        label={title}
        estimateSize={REPO_ROW_ESTIMATE_PX}
        getKey={(repo) => `${repo.owner}/${repo.name}`}
        renderItem={(repo) => <RepoRow repo={repo} showOwner={!owned} />}
        empty={
          <EmptyState
            icon={owned ? <FolderGit2 /> : <Star />}
            title={t(owned ? "account.repositories.empty" : "account.starred.empty")}
            message={t(
              owned ? "account.repositories.emptyMessage" : "account.starred.emptyMessage",
              { owner: props.login },
            )}
          />
        }
      />
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
      <InfiniteList
        query={query}
        label={title}
        estimateSize={MEMBER_ROW_ESTIMATE_PX}
        getKey={(member) => member.login}
        renderItem={(member) => (
          <Link href={`/${member.login}`} className={moduleClass(styles.member)}>
            <Avatar src={member.avatarUrl} name={member.login} size={MEMBER_AVATAR_PX} />
            <span className={styles.repoName}>{member.login}</span>
          </Link>
        )}
        empty={
          <EmptyState
            icon={<Users />}
            title={t("account.members.empty")}
            message={t("account.members.emptyMessage")}
          />
        }
      />
    </Page>
  );
}

export default function ProfileScreen() {
  const { owner } = useScreenParams(ownerRoute);
  const search: Readonly<Record<string, unknown>> = useScreenSearch(ownerRoute);
  if (search.tab === "repositories") return <RepositoriesScreen login={owner} kind="owned" />;
  if (search.tab === "stars") return <RepositoriesScreen login={owner} kind="starred" />;
  if (search.tab === "members") return <MembersScreen org={owner} />;
  return (
    <Page title={owner}>
      <ProfileView login={owner} />
    </Page>
  );
}
