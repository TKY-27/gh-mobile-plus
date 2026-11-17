import { useId } from "react";
import { Trash2 } from "lucide-react";
import { draftKeys, useDraft } from "@/data/drafts";
import type { PullRequestDetail } from "@/data/pulls";
import {
  isStalePendingReviewConflict,
  StaleReviewDrafts,
  UnrecoverableReview,
  useDiscardPendingReview,
  useSubmitReview,
  type PendingComment,
  type PendingReview,
  type ReviewEvent,
} from "@/data/review";
import { useActiveAccount } from "@/data/session";
import { Composer, useCurrentDraft } from "@/features/issue/Composer.tsx";
import { useT } from "@/i18n/index.tsx";
import { Button, IconButton } from "@/ui/Button.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { openExternal } from "@/ui/external.ts";
import { showErrorToast } from "@/ui/error-toast.ts";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { lineSpan } from "./location.ts";
import { useDraftDeletion } from "./PendingCard.tsx";
import styles from "./Review.module.css";

const EMPTY_SUMMARY: { body: string; event: ReviewEvent; headOid: string | null } = {
  body: "",
  event: "COMMENT",
  headOid: null,
};

export function SubmitSheet(props: {
  pull: PullRequestDetail;
  commitOid: string;
  baseOid: string;
  pending: PendingReview;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onShowComment: (comment: PendingComment) => void;
}) {
  const t = useT();
  const viewer = useActiveAccount();
  const headingId = useId();
  const submitReview = useSubmitReview();
  const discard = useDiscardPendingReview();
  const { pull, pending } = props;
  const deleteDraft = useDraftDeletion(pending);
  const isAuthor = pull.author?.login === viewer.login;
  const [summary, setSummary, clearSummary, summaryLoaded] = useDraft(
    `${draftKeys.pendingReview(pull.repo.owner, pull.repo.name, pull.number)}:summary`,
    EMPTY_SUMMARY,
  );
  const { body } = summary;
  const headChanged = summary.headOid !== null && summary.headOid !== props.commitOid;
  const event = headChanged ? "COMMENT" : summary.event;
  const currentSummary = useCurrentDraft({ summary, clearSummary });
  const comments = pending.comments;
  const needsBody = event !== "APPROVE" && comments.length === 0 && body.trim() === "";
  const headOid =
    submitReview.error instanceof StaleReviewDrafts ? submitReview.error.headOid : props.commitOid;
  const baseOid =
    submitReview.error instanceof StaleReviewDrafts ? submitReview.error.baseOid : props.baseOid;
  const staleDrafts = comments.filter(
    (comment) => comment.commitOid !== headOid || !comment.baseOid || comment.baseOid !== baseOid,
  );
  const blockedByStaleLines =
    staleDrafts.length > 0 && !staleDrafts.some((draft) => draft.pendingReviewId);
  const olderReviewId = isStalePendingReviewConflict(submitReview.error)
    ? submitReview.error.reviewId
    : submitReview.error instanceof StaleReviewDrafts
      ? staleDrafts.find((draft) => draft.pendingReviewId)?.pendingReviewId
      : undefined;
  const busy = submitReview.isPending || discard.isPending;
  const discardOlder = () => {
    if (!olderReviewId) return;
    discard.mutate(
      {
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        reviewId: olderReviewId,
      },
      {
        onSuccess: () => {
          submitReview.reset();
        },
        onError: (error) => {
          showErrorToast(
            t,
            error,
            t(
              error instanceof UnrecoverableReview
                ? "review.submit.backupFailed"
                : "review.submit.discardFailed",
            ),
            discardOlder,
          );
        },
      },
    );
  };

  const events = [
    { id: "COMMENT" as const, label: t("review.submit.comment") },
    { id: "APPROVE" as const, label: t("review.submit.approve") },
    { id: "REQUEST_CHANGES" as const, label: t("review.submit.requestChanges") },
  ];

  const submit = () => {
    if (
      busy ||
      needsBody ||
      blockedByStaleLines ||
      olderReviewId ||
      !pending.isLoaded ||
      !summaryLoaded
    )
      return;
    submitReview.mutate(
      {
        pullRequestId: pull.id,
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        event,
        body: body.trim(),
        commitOid: props.commitOid,
        baseOid: props.baseOid,
        comments,
      },
      {
        onError: (error) => {
          if (!isStalePendingReviewConflict(error) && !(error instanceof StaleReviewDrafts))
            showErrorToast(t, error, t("review.submit.failed"), submit);
        },
        onSuccess: (outcome) => {
          if (outcome === "draftsChanged") {
            showToast(t("review.submit.draftsChanged"));
            return;
          }
          const latest = currentSummary.current;
          if (
            latest.summary.body === body &&
            latest.summary.event === summary.event &&
            latest.clearSummary === clearSummary
          ) {
            clearSummary();
            props.onOpenChange(false);
          }
          showToast(t("review.submit.done"));
        },
      },
    );
  };

  return (
    <Sheet isOpen={props.isOpen} onOpenChange={props.onOpenChange} title={t("review.submit.title")}>
      <div className={styles.submitSheet}>
        {isAuthor ? (
          <p className={styles.note}>{t("review.submit.ownPullRequest")}</p>
        ) : summaryLoaded ? (
          <SegmentedControl
            label={t("review.submit.eventLabel")}
            segments={events}
            selected={event}
            onChange={(choice) => {
              setSummary({ body, event: choice, headOid: props.commitOid });
            }}
          />
        ) : null}
        <section aria-labelledby={headingId} className={styles.pendingList}>
          <h3 id={headingId} className={styles.listHeading}>
            {t("review.submit.pendingCount", { count: comments.length })}
          </h3>
          {comments.length > 0 ? (
            <ul>
              {comments.map((comment) => (
                <li key={comment.id} className={styles.pendingItem}>
                  {staleDrafts.includes(comment) ? (
                    <div className={styles.staleDraft}>
                      <span className={styles.pendingPath}>
                        {comment.path}:{lineSpan(comment.startLine, comment.line)}
                      </span>
                      <span>{t("review.pending.stale")}</span>
                      <p className={styles.pendingBody}>{comment.body}</p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.pendingLink}
                      onClick={() => {
                        props.onShowComment(comment);
                      }}
                    >
                      <span className={styles.pendingPath}>
                        {`${comment.path}:${lineSpan(comment.startLine, comment.line)}`}
                      </span>
                      <span className={styles.pendingExcerpt}>{comment.body}</span>
                    </button>
                  )}
                  {!comment.pendingReviewId && (
                    <IconButton
                      isDisabled={busy}
                      label={t("review.pending.deleteNamed", {
                        location: `${comment.path}:${lineSpan(comment.startLine, comment.line)}`,
                      })}
                      onPress={() => {
                        deleteDraft(comment);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        {staleDrafts.length > 0 && (
          <p className={styles.error} role="alert">
            {t("review.submit.staleDrafts")}
          </p>
        )}
        {!staleDrafts.length &&
          (headChanged || submitReview.error instanceof StaleReviewDrafts) && (
            <p className={styles.note} role="alert">
              {t("review.submit.headChanged")}
            </p>
          )}
        {olderReviewId && (
          <div className={styles.error} role="alert">
            <p>{t("review.submit.staleMessage")}</p>
            <Button variant="plain" isPending={discard.isPending} onPress={discardOlder}>
              {t("review.submit.discardOlder")}
            </Button>
          </div>
        )}
        {discard.error instanceof UnrecoverableReview ? (
          <div className={styles.error} role="alert">
            <p>{t("review.submit.backupFailed")}</p>
            <Button
              variant="plain"
              onPress={() => {
                openExternal(pull.webUrl);
              }}
            >
              {t("common.openOnGitHub")}
            </Button>
          </div>
        ) : discard.isError ? (
          <ErrorState error={discard.error} onRetry={discardOlder} />
        ) : submitReview.isError &&
          !isStalePendingReviewConflict(submitReview.error) &&
          !(submitReview.error instanceof StaleReviewDrafts) ? (
          <ErrorState error={submitReview.error} onRetry={submit} />
        ) : null}
        {needsBody ? <p className={styles.note}>{t("review.submit.needsBody")}</p> : null}
        {!blockedByStaleLines && !olderReviewId && pending.isLoaded && summaryLoaded && (
          <Composer
            label={t("review.submit.summary")}
            placeholder={t("review.submit.summaryPlaceholder")}
            value={body}
            onChange={(text) => {
              setSummary({ body: text, event, headOid: props.commitOid });
            }}
            repo={pull.repo}
            number={pull.number}
            submitLabel={t("review.submit.action")}
            onSubmit={submit}
            isPending={submitReview.isPending}
            allowEmpty={!needsBody}
          />
        )}
      </div>
    </Sheet>
  );
}
