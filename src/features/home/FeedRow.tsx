import { Link } from "react-aria-components/Link";
import type { FeedGroup, FeedSummary } from "@/data/home";
import { useT, type Translate } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import styles from "./FeedRow.module.css";

const AVATAR_PX = 36;
const MAX_DETAILS = 3;
const ROW_BASE_PX = 76;
const DETAIL_LINE_PX = 22;
const BRANCH_PREFIX = "refs/heads/";

type IssueVerb = "opened" | "closed" | "reopened" | "other";

function issueVerb(action: string): IssueVerb {
  return action === "opened" || action === "closed" || action === "reopened" ? action : "other";
}

function otherSentence(t: Translate, type: string, repo: string): string {
  switch (type) {
    case "IssueCommentEvent":
      return t("home.feed.commented", { repo });
    case "PullRequestReviewEvent":
    case "PullRequestReviewCommentEvent":
      return t("home.feed.reviewed", { repo });
    case "DeleteEvent":
      return t("home.feed.deleted", { repo });
    case "PublicEvent":
      return t("home.feed.public", { repo });
    default:
      return t("home.feed.other", { repo });
  }
}

function createSentence(t: Translate, refType: string, ref: string | null, repo: string): string {
  if (refType === "branch" && ref) return t("home.feed.createdBranch", { ref, repo });
  if (refType === "tag" && ref) return t("home.feed.createdTag", { ref, repo });
  return t("home.feed.createdRepository", { repo });
}

function sentenceFor(t: Translate, group: FeedGroup, summary: FeedSummary): string {
  const repo = group.repo ? `${group.repo.owner}/${group.repo.name}` : t("home.feed.unknownRepo");
  const count = group.events.length;
  switch (summary.kind) {
    case "star":
      return t("home.feed.starred", { repo });
    case "push": {
      const commits = group.events.reduce(
        (sum, event) => sum + (event.summary.kind === "push" ? event.summary.commits : 0),
        0,
      );
      const ref = summary.ref.startsWith(BRANCH_PREFIX)
        ? summary.ref.slice(BRANCH_PREFIX.length)
        : summary.ref;
      return t("home.feed.pushed", { count: commits, ref, repo });
    }
    case "release":
      return count > 1
        ? t("home.feed.releasedMany", { count, repo })
        : t("home.feed.released", { tag: summary.tagName, repo });
    case "issue":
      return count > 1
        ? t("home.feed.issuesMany", { count, repo })
        : t(`home.feed.issue.${issueVerb(summary.action)}`, { number: summary.number, repo });
    case "pullRequest":
      return count > 1
        ? t("home.feed.pullsMany", { count, repo })
        : t(`home.feed.pull.${issueVerb(summary.action)}`, { number: summary.number, repo });
    case "follow":
      return count > 1
        ? t("home.feed.followedMany", { count })
        : t("home.feed.followed", { user: summary.target.login });
    case "fork":
      return t("home.feed.forked", {
        repo,
        fork: `${summary.forkee.owner}/${summary.forkee.name}`,
      });
    case "create":
      return createSentence(t, summary.refType, summary.ref, repo);
    case "other":
      return otherSentence(t, summary.type, repo);
  }
}

function detailFor(summary: FeedSummary): string | null {
  switch (summary.kind) {
    case "issue":
    case "pullRequest":
      return `#${String(summary.number)} ${summary.title}`;
    case "release":
      return summary.tagName;
    case "follow":
      return summary.target.login;
    default:
      return null;
  }
}

function detailsOf(group: FeedGroup): string[] {
  const lines = group.events.flatMap((event) => {
    const detail = detailFor(event.summary);
    return detail ? [detail] : [];
  });
  // The sentence already names lone subjects.
  return lines.length === 1 && group.kind !== "issue" && group.kind !== "pullRequest" ? [] : lines;
}

function targetOf(group: FeedGroup): string | null {
  const [first] = group.events;
  if (group.events.length === 1 && first) return first.appPath;
  return group.repo ? `/${group.repo.owner}/${group.repo.name}` : null;
}

export function estimateFeedRow(group: FeedGroup): number {
  return ROW_BASE_PX + Math.min(detailsOf(group).length, MAX_DETAILS + 1) * DETAIL_LINE_PX;
}

export function FeedRow(props: { group: FeedGroup }) {
  const t = useT();
  const { group } = props;
  const [first] = group.events;
  if (!first) return null;
  const details = detailsOf(group);
  const hidden = details.length - MAX_DETAILS;
  const content = (
    <>
      <Avatar src={group.actor.avatarUrl} name={group.actor.login} size={AVATAR_PX} />
      <span className={styles.text}>
        <span className={styles.header}>
          <span className={styles.actor}>{group.actor.login}</span>
          <RelativeTime date={group.createdAt} />
        </span>
        <span className={styles.sentence}>{sentenceFor(t, group, first.summary)}</span>
        {details.slice(0, MAX_DETAILS).map((detail, index) => (
          <span key={group.events[index]?.id ?? detail} className={styles.detail}>
            {detail}
          </span>
        ))}
        {hidden > 0 ? (
          <span className={styles.more}>{t("home.feed.more", { count: hidden })}</span>
        ) : null}
      </span>
    </>
  );
  const target = targetOf(group);
  return target ? (
    <Link href={target} className={moduleClass(styles.row)}>
      {content}
    </Link>
  ) : (
    <div className={styles.row}>{content}</div>
  );
}
