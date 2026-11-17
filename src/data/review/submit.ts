import type { ResultOf } from "gql.tada";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { useCommitFileEdit, type CommitOutcome } from "../commit";
import { draftKeys } from "../drafts";
import { isGitHubError, type GitHubError } from "../errors";
import { apiPath, graphql, rest } from "../internal/client";
import { property } from "../internal/json";
import { readEntry, writeEntry, deleteEntry } from "../internal/storage";
import { restPages } from "../internal/pages";
import { gitHubFailure } from "../internal/errors";
import { useActiveAccount, type AccountId } from "../session";
import {
  addReviewThreadMutation,
  deleteReviewMutation,
  fileAtCommitQuery,
  pendingReviewQuery,
  reviewStateQuery,
  reviewDismissalsQuery,
  pullPendingReviewQuery,
  startReviewMutation,
  submitReviewMutation,
} from "./documents";
import { invalidatePullQueries, invalidateRepositoryPulls } from "./keys";
import { applySuggestion, BACKWARD_RANGE_MESSAGE } from "./patch";
import {
  changePendingComments,
  readPendingComments,
  withPendingReviewLock,
  type PendingComment,
} from "./pending";

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface ReviewSubmission {
  pullRequestId: string;
  owner: string;
  repo: string;
  number: number;
  event: ReviewEvent;
  body: string;
  commitOid: string;
  baseOid: string;
  comments: readonly PendingComment[];
}

export interface SuggestionCommit {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  expectedHeadOid: string;
  startLine: number;
  endLine: number;
  replacement: string;
  headline: string;
}

export class StalePendingReview extends Error {
  readonly kind = "conflict";
  readonly reviewId: string;
  constructor(reviewId: string) {
    super("Your pending review targets an older commit");
    this.reviewId = reviewId;
  }
}

export class StaleReviewDrafts extends Error {
  readonly kind = "conflict";
  readonly headOid: string;
  readonly baseOid: string;
  constructor(headOid: string, baseOid: string) {
    super("Review drafts need current lines");
    this.headOid = headOid;
    this.baseOid = baseOid;
  }
}

export class UnrecoverableReview extends Error {
  readonly kind = "conflict";
  constructor() {
    super("Some pending comments could not be backed up");
  }
}

export function isStalePendingReviewConflict(error: unknown): error is StalePendingReview {
  return error instanceof StalePendingReview;
}

async function startReview(
  accountId: AccountId,
  pullRequestId: string,
  commitOid: string,
): Promise<string> {
  const started = await graphql(accountId, startReviewMutation, {
    input: { pullRequestId, commitOID: commitOid },
  });
  const id = started.addPullRequestReview?.pullRequestReview?.id;
  if (!id) throw gitHubFailure({ kind: "server", status: 200 });
  return id;
}

function threadInput(pullRequestReviewId: string, comment: PendingComment) {
  const range =
    comment.startLine === undefined
      ? {}
      : { startLine: comment.startLine, startSide: comment.startSide ?? comment.side };
  return {
    pullRequestReviewId,
    path: comment.path,
    body: comment.body,
    line: comment.line,
    side: comment.side,
    ...range,
  };
}

function assertAnchorable(comments: readonly PendingComment[]): void {
  const backward = comments.some(
    (comment) => comment.side === "LEFT" && comment.startSide === "RIGHT",
  );
  if (backward) {
    throw gitHubFailure({
      kind: "validation",
      message: BACKWARD_RANGE_MESSAGE,
      fields: ["startSide"],
    });
  }
}

async function stateBeforeDismissal(accountId: AccountId, pullRequestId: string, reviewId: string) {
  let before: string | null = null;
  do {
    const result: ResultOf<typeof reviewDismissalsQuery> = await graphql(
      accountId,
      reviewDismissalsQuery,
      {
        pullRequestId,
        before,
      },
    );
    const pull = result.node;
    if (!pull || !("timelineItems" in pull)) throw gitHubFailure({ kind: "notFound" });
    const timeline = pull.timelineItems;
    for (const entry of timeline.nodes ?? []) {
      if (entry && "review" in entry && entry.review?.id === reviewId)
        return entry.previousReviewState;
    }
    before = timeline.pageInfo.hasPreviousPage ? timeline.pageInfo.startCursor : null;
  } while (before !== null);
  throw gitHubFailure({
    kind: "conflict",
    message: "The original review event could not be verified",
  });
}

async function publishedDrafts(
  accountId: AccountId,
  location: ReviewSubmission,
  comments: readonly PendingComment[],
  currentReviewId: string | undefined,
  summaryKey: string,
) {
  const previousIds = new Set(
    comments.flatMap(({ pendingReviewId }) =>
      pendingReviewId && pendingReviewId !== currentReviewId ? [pendingReviewId] : [],
    ),
  );
  const receipt = await readEntry("drafts", accountId, summaryKey);
  const receiptId = property(receipt, "reviewId");
  const sameIntent =
    property(receipt, "event") === location.event &&
    property(receipt, "body") === location.body &&
    property(receipt, "commitOid") === location.commitOid;
  if (sameIntent && typeof receiptId === "string" && receiptId !== currentReviewId) {
    previousIds.add(receiptId);
  }
  const published = new Set<string>();
  let summarySubmitted = false;
  for (const id of previousIds) {
    const result = await graphql(accountId, reviewStateQuery, { id });
    const previous = result.node;
    if (!previous || !("state" in previous) || previous.state === "PENDING") continue;
    if (previous.body === location.body && previous.commit?.oid === location.commitOid) {
      if (id === receiptId) summarySubmitted ||= sameIntent;
      else {
        const originalState =
          previous.state === "DISMISSED"
            ? await stateBeforeDismissal(accountId, location.pullRequestId, id)
            : previous.state;
        summarySubmitted ||= originalState === submittedStates[location.event];
      }
    }
    const attached = comments.filter((draft) => draft.pendingReviewId === id);
    const remote = attached.some((draft) => draft.previousMatches !== undefined)
      ? await archivedComments(
          accountId,
          location,
          previous.databaseId,
          previous.comments.totalCount,
        )
      : [];
    for (const draft of attached) {
      if (
        draft.previousMatches === undefined ||
        remote.filter((comment) => sameComment(draft, comment)).length > draft.previousMatches
      )
        published.add(draft.id);
    }
  }
  return { published, summarySubmitted };
}

function sameComment(first: PendingComment, second: PendingComment): boolean {
  return (
    first.path === second.path &&
    first.line === second.line &&
    first.side === second.side &&
    first.body === second.body &&
    first.startLine === second.startLine &&
    (!first.startLine || (first.startSide ?? first.side) === (second.startSide ?? second.side))
  );
}

function withoutReceipt(draft: PendingComment): PendingComment {
  const local = { ...draft };
  delete local.pendingReviewId;
  delete local.previousMatches;
  return local;
}

async function sendThread(
  accountId: AccountId,
  draftKey: string,
  reviewId: string,
  comment: PendingComment,
  observed: PendingComment[],
): Promise<void> {
  const matches = observed.filter((previous) => sameComment(previous, comment)).length;
  const alreadyAdded =
    comment.pendingReviewId === reviewId &&
    comment.previousMatches !== undefined &&
    matches > comment.previousMatches;
  if (!alreadyAdded) {
    const intent = { ...comment, pendingReviewId: reviewId, previousMatches: matches };
    const stored = await changePendingComments(accountId, draftKey, (drafts) =>
      drafts.map((draft) =>
        draft.id === comment.id && sameComment(draft, comment) ? intent : draft,
      ),
    );
    if (!stored.includes(intent)) return;
    try {
      const added = await graphql(accountId, addReviewThreadMutation, {
        input: threadInput(reviewId, comment),
      });
      if (!added.addPullRequestReviewThread?.thread)
        throw gitHubFailure({ kind: "server", status: 200 });
    } catch (error) {
      if (
        isGitHubError(error) &&
        (error.kind === "validation" ||
          error.kind === "forbidden" ||
          error.kind === "orgAccessRestricted")
      ) {
        await changePendingComments(accountId, draftKey, (drafts) =>
          drafts.map((draft) => (draft.id === comment.id ? withoutReceipt(draft) : draft)),
        );
      }
      throw error;
    }
    observed.push(comment);
  }
  await changePendingComments(accountId, draftKey, (drafts) =>
    drafts.map((draft) =>
      draft.id === comment.id ? { ...withoutReceipt(draft), pendingReviewId: reviewId } : draft,
    ),
  );
}

const submittedStates = {
  COMMENT: "COMMENTED",
  APPROVE: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
} as const;

async function submitReview(
  accountId: AccountId,
  login: string,
  review: ReviewSubmission,
): Promise<undefined | "draftsChanged"> {
  assertAnchorable(review.comments);
  const draftKey = draftKeys.pendingReview(review.owner, review.repo, review.number);
  const snapshotIds = new Set(review.comments.map((comment) => comment.id));
  const pending = await readPendingComments(accountId, draftKey);
  const comments = pending.filter((comment) => snapshotIds.has(comment.id));
  if (snapshotIds.size > 0 && comments.length === 0) return "draftsChanged";

  const summaryKey = `${draftKey}:submission`;
  const found = await graphql(accountId, pendingReviewQuery, {
    pullRequestId: review.pullRequestId,
    author: login,
  });
  const pull = found.node;
  if (!pull || !("headRefOid" in pull)) throw gitHubFailure({ kind: "notFound" });
  const existing = pull.reviews?.nodes?.[0];
  const { published, summarySubmitted } = await publishedDrafts(
    accountId,
    review,
    comments,
    existing?.id,
    summaryKey,
  );
  const remaining = comments.filter((draft) => !published.has(draft.id));
  if (!remaining.length && summarySubmitted) {
    if (published.size)
      await changePendingComments(accountId, draftKey, (drafts) =>
        drafts.filter((draft) => !published.has(draft.id)),
      );
    await deleteEntry("drafts", accountId, summaryKey);
    return;
  }
  if (
    existing &&
    (existing.commit?.oid !== pull.headRefOid ||
      pending.some(
        (draft) =>
          draft.pendingReviewId === existing.id &&
          (!draft.baseOid || draft.baseOid !== pull.baseRefOid),
      ))
  ) {
    throw new StalePendingReview(existing.id);
  }
  if (
    review.commitOid !== pull.headRefOid ||
    review.baseOid !== pull.baseRefOid ||
    remaining.some(
      (draft) =>
        draft.commitOid !== pull.headRefOid || !draft.baseOid || draft.baseOid !== pull.baseRefOid,
    )
  ) {
    if (published.size)
      await changePendingComments(accountId, draftKey, (drafts) =>
        drafts.filter((draft) => !published.has(draft.id)),
      );
    throw new StaleReviewDrafts(pull.headRefOid, pull.baseRefOid);
  }
  const reviewId =
    existing?.id ?? (await startReview(accountId, review.pullRequestId, pull.headRefOid));
  const sending = remaining.filter(
    (draft) => draft.pendingReviewId !== reviewId || draft.previousMatches !== undefined,
  );
  const observed =
    existing && sending.length
      ? await archivedComments(accountId, review, existing.databaseId, existing.comments.totalCount)
      : [];
  for (const comment of sending) {
    await sendThread(accountId, draftKey, reviewId, comment, observed);
  }
  await writeEntry("drafts", accountId, summaryKey, {
    reviewId,
    body: review.body,
    event: review.event,
    commitOid: review.commitOid,
  });
  const submitted = await graphql(accountId, submitReviewMutation, {
    input: { pullRequestReviewId: reviewId, event: review.event, body: review.body },
  }).catch(async (error: unknown) => {
    if (isGitHubError(error) && error.kind !== "network" && error.kind !== "server") {
      await deleteEntry("drafts", accountId, summaryKey);
    }
    throw error;
  });
  if (submitted.submitPullRequestReview?.pullRequestReview?.id !== reviewId) {
    throw gitHubFailure({ kind: "server", status: 200 });
  }
  await changePendingComments(accountId, draftKey, (drafts) =>
    drafts.filter(
      (draft) =>
        !published.has(draft.id) &&
        (draft.pendingReviewId !== reviewId || draft.previousMatches !== undefined),
    ),
  );
  await deleteEntry("drafts", accountId, summaryKey);
}

export function useSubmitReview(): UseMutationResult<
  undefined | "draftsChanged",
  GitHubError,
  ReviewSubmission
> {
  const { id: accountId, login } = useActiveAccount();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (review) =>
      withPendingReviewLock(
        accountId,
        draftKeys.pendingReview(review.owner, review.repo, review.number),
        () => submitReview(accountId, login, review),
      ),
    onSettled: (_data, _error, { owner, repo, number }) =>
      invalidatePullQueries(client, accountId, owner, repo, number),
  });
}

interface ReviewLocation {
  owner: string;
  repo: string;
  number: number;
  reviewId: string;
}

interface ArchivedComment {
  id: number;
  node_id: string;
  path: string;
  body: string;
  original_commit_id?: string;
  original_line?: number | null;
  side?: PendingComment["side"] | null;
  original_start_line?: number | null;
  start_side?: PendingComment["side"] | null;
}

async function archivedComments(
  accountId: AccountId,
  location: Pick<ReviewLocation, "owner" | "repo" | "number">,
  databaseId: number | null,
  count: number,
) {
  if (count === 0) return [];
  if (databaseId === null) throw new UnrecoverableReview();
  const { owner, repo, number } = location;
  const pages = await restPages<ArchivedComment[]>(accountId, {
    path: apiPath`/repos/${owner}/${repo}/pulls/${number}/reviews/${databaseId}/comments`,
    revalidate: true,
  });
  const listed = pages.flat();
  if (listed.length !== count) throw new UnrecoverableReview();
  const archived: ArchivedComment[] = [];
  for (const comment of listed) {
    if (comment.original_line && comment.side) {
      archived.push(comment);
    } else {
      const detail = await rest<ArchivedComment>(accountId, {
        path: apiPath`/repos/${owner}/${repo}/pulls/comments/${comment.id}`,
      });
      if (detail.body.node_id !== comment.node_id) throw new UnrecoverableReview();
      archived.push(detail.body);
    }
  }
  return archived.map((comment): PendingComment => {
    if (
      !comment.node_id ||
      typeof comment.body !== "string" ||
      !comment.path ||
      !comment.original_line ||
      (comment.side !== "LEFT" && comment.side !== "RIGHT")
    )
      throw new UnrecoverableReview();
    return {
      id: comment.node_id,
      path: comment.path,
      line: comment.original_line,
      side: comment.side,
      body: comment.body,
      ...(comment.original_commit_id ? { commitOid: comment.original_commit_id } : {}),
      ...(comment.original_start_line ? { startLine: comment.original_start_line } : {}),
      ...(comment.start_side ? { startSide: comment.start_side } : {}),
    };
  });
}

function restoreArchived(
  drafts: readonly PendingComment[],
  archived: readonly PendingComment[],
  reviewId: string,
) {
  const backedUp = drafts.filter((draft) => draft.pendingReviewId === reviewId);
  const recovered = archived.filter((comment) => {
    const matching = backedUp.findIndex((draft) => sameComment(draft, comment));
    if (matching < 0) return true;
    backedUp.splice(matching, 1);
    return false;
  });
  return [...drafts, ...recovered.map((draft) => ({ ...draft, pendingReviewId: reviewId }))];
}

export function useDiscardPendingReview(): UseMutationResult<void, GitHubError, ReviewLocation> {
  const { id: accountId, login } = useActiveAccount();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (location) =>
      withPendingReviewLock(
        accountId,
        draftKeys.pendingReview(location.owner, location.repo, location.number),
        async () => {
          const { owner, repo, number, reviewId } = location;
          const found = await graphql(accountId, pullPendingReviewQuery, {
            owner,
            repo,
            number,
            author: login,
          });
          const pull = found.repository?.pullRequest;
          if (!pull) throw gitHubFailure({ kind: "notFound" });
          const review = pull.reviews?.nodes?.[0];
          if (review) {
            const drafts = await readPendingComments(
              accountId,
              draftKeys.pendingReview(owner, repo, number),
            );
            const staleBase = drafts.some(
              (draft) => draft.pendingReviewId === reviewId && draft.baseOid !== pull.baseRefOid,
            );
            if (
              review.id !== reviewId ||
              (review.commit?.oid === pull.headRefOid && !staleBase) ||
              review.body.trim() !== ""
            )
              throw new UnrecoverableReview();
            const archived = await archivedComments(
              accountId,
              location,
              review.databaseId,
              review.comments.totalCount,
            );
            await changePendingComments(
              accountId,
              draftKeys.pendingReview(owner, repo, number),
              (drafts) => restoreArchived(drafts, archived, reviewId),
            );
            const deleted = await graphql(accountId, deleteReviewMutation, {
              input: { pullRequestReviewId: reviewId },
            });
            if (deleted.deletePullRequestReview?.pullRequestReview?.id !== reviewId)
              throw gitHubFailure({ kind: "server", status: 200 });
          }
          await changePendingComments(
            accountId,
            draftKeys.pendingReview(owner, repo, number),
            (drafts) =>
              drafts.map((draft) =>
                draft.pendingReviewId === reviewId ? withoutReceipt(draft) : draft,
              ),
          );
        },
      ),
    onSettled: (_result, _error, { owner, repo, number }) =>
      invalidatePullQueries(client, accountId, owner, repo, number),
  });
}

async function fileAtCommit(
  accountId: AccountId,
  { owner, repo, expectedHeadOid, path }: SuggestionCommit,
): Promise<string> {
  const result = await graphql(accountId, fileAtCommitQuery, {
    owner,
    repo,
    oid: expectedHeadOid,
    path,
  });
  const commit = result.repository?.object;
  const blob = commit && "file" in commit ? commit.file?.object : null;
  if (!blob || !("text" in blob)) throw gitHubFailure({ kind: "notFound" });
  // Committing partial text would truncate the file.
  if (blob.isBinary === true || blob.isTruncated || blob.text === null) {
    throw gitHubFailure({
      kind: "validation",
      message: "File is not editable text",
      fields: ["path"],
    });
  }
  return blob.text;
}

export function useCommitSuggestion(): UseMutationResult<
  CommitOutcome,
  GitHubError,
  SuggestionCommit
> {
  const accountId = useActiveAccount().id;
  const client = useQueryClient();
  const commitFileEdit = useCommitFileEdit();
  return useMutation({
    retry: false,
    onSuccess: (_outcome, { owner, repo }) =>
      invalidateRepositoryPulls(client, accountId, owner, repo),
    mutationFn: async (suggestion) => {
      const text = await fileAtCommit(accountId, suggestion);
      const { startLine, endLine } = suggestion;
      const content = applySuggestion(text, startLine, endLine, suggestion.replacement);
      if (content === null) {
        throw gitHubFailure({
          kind: "validation",
          message: "Suggestion lines are outside the file",
          fields: ["startLine", "endLine"],
        });
      }
      return commitFileEdit.mutateAsync({
        owner: suggestion.owner,
        repo: suggestion.repo,
        branch: suggestion.branch,
        path: suggestion.path,
        content,
        expectedHeadOid: suggestion.expectedHeadOid,
        message: { headline: suggestion.headline, body: "" },
        target: { kind: "direct" },
      });
    },
  });
}
