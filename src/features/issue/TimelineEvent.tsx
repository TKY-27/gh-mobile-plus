import type { ReactNode } from "react";
import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  CircleX,
  GitCommitHorizontal,
  GitMerge,
  Link2,
  MessageSquare,
  Pencil,
  Tag,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Link } from "react-aria-components/Link";
import type { TimelineItem } from "@/data/issues";
import type { Actor, RepoRef } from "@/data/types";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { CommentCard, MarkdownBody } from "./CommentCard.tsx";
import { LabelChip } from "./LabelChip.tsx";
import { richMessage } from "./rich-message.tsx";
import styles from "./Conversation.module.css";

const SHORT_OID_LENGTH = 7;

type EventItem = Exclude<TimelineItem, { kind: "comment" | "other" }>;
type Tone = "neutral" | "success" | "failure" | "merged" | "draft";

interface EventContent {
  icon: ReactNode;
  tone: Tone;
  text: ReactNode;
  body?: string;
}

const REVIEW_STATES = {
  approved: { key: "issue.timeline.reviewApproved", tone: "success", icon: <CircleCheck /> },
  changesRequested: {
    key: "issue.timeline.reviewChangesRequested",
    tone: "failure",
    icon: <CircleX />,
  },
  commented: { key: "issue.timeline.reviewCommented", tone: "neutral", icon: <MessageSquare /> },
  dismissed: { key: "issue.timeline.reviewDismissed", tone: "draft", icon: <MessageSquare /> },
} as const satisfies Record<string, { key: MessageKey; tone: Tone; icon: ReactNode }>;

function useEventContent(entry: EventItem, repo: RepoRef): EventContent {
  const t = useT();
  const name = (actor: Actor | null) => (
    <strong className={styles.actor}>{actor?.login ?? t("issue.timeline.ghost")}</strong>
  );
  switch (entry.kind) {
    case "labeled":
    case "unlabeled":
      return {
        icon: <Tag />,
        tone: "neutral",
        text: richMessage(t, `issue.timeline.${entry.kind}`, {
          actor: name(entry.actor),
          label: <LabelChip label={entry.label} />,
        }),
      };
    case "assigned":
    case "unassigned": {
      const self = entry.actor !== null && entry.actor.login === entry.assignee?.login;
      const key: MessageKey = self
        ? `issue.timeline.${entry.kind}Self`
        : `issue.timeline.${entry.kind}`;
      return {
        icon: entry.kind === "assigned" ? <UserPlus /> : <UserMinus />,
        tone: "neutral",
        text: richMessage(t, key, { actor: name(entry.actor), assignee: name(entry.assignee) }),
      };
    }
    case "crossReferenced": {
      const { source } = entry;
      const path = `/${source.repo.owner}/${source.repo.name}/${source.isPullRequest ? "pull" : "issues"}/${String(source.number)}`;
      return {
        icon: <Link2 />,
        tone: "neutral",
        text: richMessage(t, "issue.timeline.crossReferenced", {
          actor: name(entry.actor),
          source: (
            <Link href={path} className={moduleClass(styles.inlineLink)}>
              {`${source.repo.owner}/${source.repo.name}#${String(source.number)} ${source.title}`}
            </Link>
          ),
        }),
      };
    }
    case "commit":
      return {
        icon: <GitCommitHorizontal />,
        tone: "neutral",
        text: richMessage(t, "issue.timeline.commit", {
          actor: name(entry.author),
          commit: (
            <Link
              href={`/${repo.owner}/${repo.name}/commit/${entry.oid}`}
              className={moduleClass(styles.inlineLink)}
            >
              <code className={styles.oid}>{entry.oid.slice(0, SHORT_OID_LENGTH)}</code>{" "}
              {entry.headline}
            </Link>
          ),
        }),
      };
    case "closed": {
      const notPlanned = entry.stateReason === "notPlanned";
      return {
        icon: notPlanned ? <CircleSlash /> : <CircleCheck />,
        tone: notPlanned ? "draft" : "merged",
        text: richMessage(
          t,
          entry.stateReason === null
            ? "issue.timeline.closed"
            : notPlanned
              ? "issue.timeline.closedNotPlanned"
              : "issue.timeline.closedCompleted",
          { actor: name(entry.actor) },
        ),
      };
    }
    case "reopened":
      return {
        icon: <CircleDot />,
        tone: "success",
        text: richMessage(t, "issue.timeline.reopened", { actor: name(entry.actor) }),
      };
    case "renamed":
      return {
        icon: <Pencil />,
        tone: "neutral",
        text: richMessage(t, "issue.timeline.renamed", {
          actor: name(entry.actor),
          from: <del className={styles.renamedFrom}>{entry.from}</del>,
          to: <span className={styles.renamedTo}>{entry.to}</span>,
        }),
      };
    case "review": {
      const state = REVIEW_STATES[entry.state];
      return {
        icon: state.icon,
        tone: state.tone,
        text: richMessage(t, state.key, { actor: name(entry.author) }),
        body: entry.bodyHtml,
      };
    }
    case "merged":
      return {
        icon: <GitMerge />,
        tone: "merged",
        text: richMessage(t, "issue.timeline.merged", { actor: name(entry.actor) }),
      };
  }
}

function EventRow(props: { entry: EventItem; repo: RepoRef }) {
  const content = useEventContent(props.entry, props.repo);
  return (
    <div className={styles.event}>
      <span className={styles.eventIcon} data-tone={content.tone} aria-hidden>
        {content.icon}
      </span>
      <div className={styles.eventText}>
        <p>
          {content.text} <RelativeTime date={props.entry.createdAt} />
        </p>
        {content.body ? <MarkdownBody html={content.body} /> : null}
      </div>
    </div>
  );
}

export function TimelineEntry(props: {
  entry: Exclude<TimelineItem, { kind: "other" }>;
  repo: RepoRef;
}) {
  const { entry } = props;
  if (entry.kind === "comment") {
    return (
      <CommentCard
        subjectId={entry.id}
        author={entry.author}
        createdAt={entry.createdAt}
        bodyHtml={entry.bodyHtml}
        reactions={entry.reactions}
        canReact={entry.viewerCanReact}
      />
    );
  }
  return <EventRow entry={entry} repo={props.repo} />;
}
