import { useState } from "react";
import {
  ChevronDown,
  CircleCheck,
  ExternalLink,
  GitCommitHorizontal,
  MessageSquareReply,
} from "lucide-react";
import type { PullRequestDetail } from "@/data/pulls";
import {
  useCommitSuggestion,
  useResolveThread,
  type ReviewComment,
  type ReviewThread,
} from "@/data/review";
import { useActiveAccount } from "@/data/session";
import { MarkdownBody } from "@/features/issue/CommentCard.tsx";
import { ConfirmSheet } from "@/ui/ConfirmSheet.tsx";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { Button } from "@/ui/Button.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { lineLocation } from "./location.ts";
import styles from "./Review.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const AVATAR_PX = 22;
// Repository content, so not localized.
const SUGGESTION_HEADLINE = "Apply suggestion from code review";

function CommitSuggestion(props: {
  pull: PullRequestDetail;
  thread: ReviewThread;
  comment: ReviewComment;
}) {
  const t = useT();
  const commit = useCommitSuggestion();
  const [confirming, setConfirming] = useState(false);
  const { pull, thread, comment } = props;
  const { line, startLine } = thread;
  const suggestion = comment.suggestion;
  if (suggestion === null || line === null || thread.side !== "RIGHT") return null;
  const head = pull.headRepo ?? pull.repo;

  const run = () => {
    commit.mutate(
      {
        owner: head.owner,
        repo: head.name,
        branch: pull.headRef,
        path: thread.path,
        expectedHeadOid: pull.headOid,
        startLine: startLine ?? line,
        endLine: line,
        replacement: suggestion,
        headline: SUGGESTION_HEADLINE,
      },
      {
        onSuccess: () => {
          showToast(t("review.suggestion.committed"));
        },
        onError: (error) => {
          showErrorToast(t, error, t("review.suggestion.failed"), run);
        },
      },
    );
  };

  return (
    <>
      <Button
        icon={<GitCommitHorizontal aria-hidden />}
        isPending={commit.isPending}
        isDisabled={commit.isSuccess}
        onPress={() => {
          setConfirming(true);
        }}
      >
        {commit.isSuccess ? t("review.suggestion.done") : t("review.suggestion.commit")}
      </Button>
      <ConfirmSheet
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t("review.suggestion.confirmTitle")}
        message={t("review.suggestion.confirmMessage", { branch: pull.headRef, path: thread.path })}
        confirmLabel={t("review.suggestion.commit")}
        onConfirm={run}
      />
    </>
  );
}

export function ThreadCard(props: {
  pull: PullRequestDetail;
  thread: ReviewThread;
  onReply: (thread: ReviewThread) => void;
}) {
  const t = useT();
  const viewer = useActiveAccount();
  const resolve = useResolveThread();
  const { pull, thread } = props;
  const [expanded, setExpanded] = useState(!thread.isResolved);
  const canCommit = pull.state === "open";

  const setResolved = (resolved: boolean) => {
    resolve.mutate(
      {
        threadId: thread.id,
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        resolved,
      },
      {
        onError: (error) => {
          showErrorToast(t, error, t("review.thread.resolveFailed"), () => {
            setResolved(resolved);
          });
        },
      },
    );
  };

  const heading =
    thread.isOutdated || thread.line === null
      ? t("review.thread.outdated")
      : lineLocation(t, thread.startLine, thread.line);

  return (
    <section
      className={styles.thread}
      aria-label={heading}
      data-resolved={thread.isResolved || undefined}
    >
      <header className={styles.threadHeader}>
        {thread.isResolved ? <CircleCheck className={styles.resolvedIcon} aria-hidden /> : null}
        <span className={styles.threadTitle}>
          {thread.isResolved ? t("review.thread.resolved") : heading}
        </span>
        {thread.isResolved ? (
          <Button
            variant="plain"
            icon={
              <ChevronDown
                aria-hidden
                className={styles.disclosure}
                data-open={expanded || undefined}
              />
            }
            aria-expanded={expanded}
            onPress={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded ? t("review.thread.hide") : t("review.thread.show")}
          </Button>
        ) : null}
      </header>
      {expanded ? (
        <>
          <ol className={styles.threadComments}>
            {thread.comments.map((comment) => {
              const login = comment.author?.login ?? t("issue.timeline.ghost");
              return (
                <li key={comment.id} className={styles.threadComment}>
                  <p className={styles.threadAuthor}>
                    <Avatar src={comment.author?.avatarUrl ?? null} name={login} size={AVATAR_PX} />
                    <strong>{login}</strong>
                    <RelativeTime date={comment.createdAt} />
                  </p>
                  <MarkdownBody html={comment.bodyHtml} />
                  {canCommit && comment.author?.login !== viewer.login ? (
                    <CommitSuggestion pull={pull} thread={thread} comment={comment} />
                  ) : null}
                </li>
              );
            })}
          </ol>
          {thread.hasMoreComments ? (
            <a
              className={styles.moreLink}
              href={pull.webUrl + "/files"}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("review.thread.more")}
              <ExternalLink aria-hidden />
            </a>
          ) : null}
          <div className={styles.threadActions}>
            <Button
              variant="plain"
              icon={<MessageSquareReply aria-hidden />}
              onPress={() => {
                props.onReply(thread);
              }}
            >
              {t("review.thread.reply")}
            </Button>
            {thread.viewerCanResolve ? (
              <Button
                variant="plain"
                onPress={() => {
                  setResolved(!thread.isResolved);
                }}
              >
                {thread.isResolved ? t("review.thread.unresolve") : t("review.thread.resolve")}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
