import { GitCommitHorizontal } from "lucide-react";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { pullCommitsRoute } from "@/app/router.ts";
import {
  usePullCommits,
  usePullRequest,
  type PullCommit,
  type PullRequestDetail,
} from "@/data/pulls";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ListRow } from "@/ui/ListRow.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { StatusIcon } from "@/ui/StatusIcon.tsx";
import { InfiniteList } from "@/ui/VirtualList.tsx";
import { PullGate, PullPage } from "./PullPage.tsx";
import styles from "./Pull.module.css";

const ROW_ESTIMATE_PX = 72;
const AVATAR_PX = 28;
const SHORT_OID_LENGTH = 7;

function CommitRow(props: { pull: PullRequestDetail; commit: PullCommit }) {
  const t = useT();
  const { pull, commit } = props;
  const author = commit.author?.login ?? t("issue.timeline.ghost");
  return (
    <ListRow
      leading={<Avatar src={commit.author?.avatarUrl ?? null} name={author} size={AVATAR_PX} />}
      title={commit.headline}
      subtitle={
        <span className={styles.commitMeta}>
          <code>{commit.oid.slice(0, SHORT_OID_LENGTH)}</code>
          <span>{author}</span>
          <RelativeTime date={commit.committedAt} />
        </span>
      }
      detail={commit.checks ? <StatusIcon status={commit.checks} /> : undefined}
      href={`/${pull.repo.owner}/${pull.repo.name}/commit/${commit.oid}`}
    />
  );
}

function Commits(props: { pull: PullRequestDetail; commits: ReturnType<typeof usePullCommits> }) {
  const t = useT();
  const { pull, commits } = props;
  return (
    <div className={styles.commitList}>
      <InfiniteList
        query={commits}
        label={t("pull.commits.label")}
        estimateSize={ROW_ESTIMATE_PX}
        getKey={(commit) => commit.oid}
        renderItem={(commit) => <CommitRow pull={pull} commit={commit} />}
        empty={
          <EmptyState
            icon={<GitCommitHorizontal />}
            title={t("pull.commits.emptyTitle")}
            message={t("pull.commits.emptyMessage")}
          />
        }
      />
    </div>
  );
}

export default function CommitsScreen() {
  const { owner, repo, number } = useScreenParams(pullCommitsRoute);
  const pull = usePullRequest(owner, repo, number);
  const pullOwner = pull.data?.repo.owner ?? owner;
  const pullRepo = pull.data?.repo.name ?? repo;
  const commits = usePullCommits(pullOwner, pullRepo, number);
  return (
    <PullGate query={pull} number={number}>
      {(detail) => (
        <PullPage pull={detail} tab="commits">
          <Commits pull={detail} commits={commits} />
        </PullPage>
      )}
    </PullGate>
  );
}
