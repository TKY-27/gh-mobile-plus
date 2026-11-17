import type { ResultOf } from "gql.tada";
import { graphql } from "../internal/graphql";
import { checksState, reviewDecision } from "../internal/subject-status";
import type { SubjectDetail } from "../issues/conversation";
import type { MergeMethod } from "../repo";
import type { Actor, ChecksState, RepoRef, ReviewDecision } from "../types";

export type MergeBlockedReason =
  | "reviewRequired"
  | "changesRequested"
  | "checksFailing"
  | "checksPending"
  | "conflicts"
  | "behind"
  | "draft"
  | "blockedByRule";

export interface PullRequestDetail extends SubjectDetail {
  state: "open" | "closed" | "merged";
  isDraft: boolean;
  baseRef: string;
  headRef: string;
  headRepo: RepoRef | null;
  headOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commitsCount: number;
  reviewDecision: ReviewDecision;
  requestedReviewers: readonly (Actor | { team: string })[];
  latestReviews: readonly {
    author: Actor | null;
    state: "approved" | "changesRequested" | "commented" | "dismissed";
  }[];
  checks: ChecksState;
  merge: {
    mergeable: "mergeable" | "conflicting" | "unknown";
    state: "clean" | "blocked" | "behind" | "dirty" | "draft" | "hasHooks" | "unstable" | "unknown";
    blockedReasons: readonly MergeBlockedReason[];
    allowedMethods: readonly MergeMethod[];
    defaultMethod: MergeMethod;
    viewerCanMerge: boolean;
    defaultTitle: Record<MergeMethod, string>;
    defaultMessage: Record<MergeMethod, string>;
    canDeleteHeadBranch: boolean;
  };
  viewerCan: SubjectDetail["viewerCan"] & { updateBranch: boolean; markReady: boolean };
}

export const mergeSettingsFragment = graphql(`
  fragment MergeSettingsFields on Repository @_unmask {
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    viewerDefaultMergeMethod
  }
`);

export const pullRequestFragment = graphql(`
  fragment PullRequestDetailFields on PullRequest @_unmask {
    state
    isDraft
    baseRefName
    headRefName
    headRefOid
    headRepository {
      name
      owner {
        login
      }
    }
    headRef {
      id
    }
    additions
    deletions
    changedFiles
    commits {
      totalCount
    }
    reviewDecision
    reviewRequests(first: 50) {
      nodes {
        requestedReviewer {
          __typename
          ... on Actor {
            login
            avatarUrl
          }
          ... on Team {
            combinedSlug
          }
          ... on EnterpriseTeam {
            combinedSlug
          }
        }
      }
    }
    latestReviews(first: 50) {
      nodes {
        author {
          login
          avatarUrl
        }
        state
      }
    }
    statusCheckRollup {
      state
    }
    mergeable
    mergeStateStatus
    viewerCanUpdate
    viewerCanUpdateBranch
    viewerCanDeleteHeadRef
    mergeHeadline: viewerMergeHeadlineText(mergeType: MERGE)
    squashHeadline: viewerMergeHeadlineText(mergeType: SQUASH)
    rebaseHeadline: viewerMergeHeadlineText(mergeType: REBASE)
    mergeBody: viewerMergeBodyText(mergeType: MERGE)
    squashBody: viewerMergeBodyText(mergeType: SQUASH)
    rebaseBody: viewerMergeBodyText(mergeType: REBASE)
  }
`);

type PullRequestFields = ResultOf<typeof pullRequestFragment>;
type MergeSettings = ResultOf<typeof mergeSettingsFragment>;
export type MergeStatusFields = Pick<
  PullRequestFields,
  "state" | "isDraft" | "mergeable" | "mergeStateStatus" | "reviewDecision" | "statusCheckRollup"
>;

const MERGE_STATES = {
  BEHIND: "behind",
  BLOCKED: "blocked",
  CLEAN: "clean",
  DIRTY: "dirty",
  DRAFT: "draft",
  HAS_HOOKS: "hasHooks",
  UNKNOWN: "unknown",
  UNSTABLE: "unstable",
} as const;
const MERGEABLE_STATES = {
  MERGEABLE: "mergeable",
  CONFLICTING: "conflicting",
  UNKNOWN: "unknown",
} as const;
const MERGE_METHODS = { MERGE: "merge", SQUASH: "squash", REBASE: "rebase" } as const;
const REVIEW_STATES = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changesRequested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: null,
} as const;

// GitHub can withhold branch rule details.
export function blockedReasons(pullRequest: MergeStatusFields): MergeBlockedReason[] {
  if (pullRequest.state !== "OPEN") return [];
  const reasons: MergeBlockedReason[] = [];
  if (pullRequest.isDraft) reasons.push("draft");
  if (pullRequest.mergeable === "CONFLICTING") reasons.push("conflicts");
  if (pullRequest.mergeStateStatus === "BEHIND") reasons.push("behind");
  if (pullRequest.mergeStateStatus !== "BLOCKED") return reasons;
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") reasons.push("changesRequested");
  if (pullRequest.reviewDecision === "REVIEW_REQUIRED") reasons.push("reviewRequired");
  const checks = checksState(pullRequest.statusCheckRollup?.state);
  if (checks === "failure") reasons.push("checksFailing");
  if (checks === "pending") reasons.push("checksPending");
  if (reasons.length === 0) reasons.push("blockedByRule");
  return reasons;
}

function allowedMethods(settings: MergeSettings): MergeMethod[] {
  const methods: MergeMethod[] = [];
  if (settings.squashMergeAllowed) methods.push("squash");
  if (settings.mergeCommitAllowed) methods.push("merge");
  if (settings.rebaseMergeAllowed) methods.push("rebase");
  return methods;
}

function requestedReviewers(pullRequest: PullRequestFields): (Actor | { team: string })[] {
  return (pullRequest.reviewRequests?.nodes ?? []).flatMap(
    (request): (Actor | { team: string })[] => {
      const reviewer = request?.requestedReviewer;
      if (!reviewer) return [];
      if (reviewer.__typename === "Team" || reviewer.__typename === "EnterpriseTeam") {
        return [{ team: reviewer.combinedSlug }];
      }
      return [{ login: reviewer.login, avatarUrl: reviewer.avatarUrl }];
    },
  );
}

export function mapPullRequest(
  subject: SubjectDetail,
  pullRequest: PullRequestFields,
  settings: MergeSettings,
  access: { canPush: boolean; writable: boolean },
): PullRequestDetail {
  const isOpen = pullRequest.state === "OPEN";
  const canWrite = isOpen && access.writable;
  const methods = allowedMethods(settings);
  const preferred = MERGE_METHODS[settings.viewerDefaultMergeMethod];
  return {
    ...subject,
    state: isOpen ? "open" : pullRequest.state === "MERGED" ? "merged" : "closed",
    isDraft: pullRequest.isDraft,
    baseRef: pullRequest.baseRefName,
    headRef: pullRequest.headRefName,
    headRepo: pullRequest.headRepository
      ? { owner: pullRequest.headRepository.owner.login, name: pullRequest.headRepository.name }
      : null,
    headOid: pullRequest.headRefOid,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changedFiles: pullRequest.changedFiles,
    commitsCount: pullRequest.commits.totalCount,
    reviewDecision: reviewDecision(pullRequest.reviewDecision),
    requestedReviewers: requestedReviewers(pullRequest),
    latestReviews: (pullRequest.latestReviews?.nodes ?? []).flatMap((review) => {
      const state = review ? REVIEW_STATES[review.state] : null;
      return review && state ? [{ author: review.author, state }] : [];
    }),
    checks: checksState(pullRequest.statusCheckRollup?.state),
    merge: {
      mergeable: MERGEABLE_STATES[pullRequest.mergeable],
      state: MERGE_STATES[pullRequest.mergeStateStatus],
      blockedReasons: blockedReasons(pullRequest),
      allowedMethods: methods,
      defaultMethod: methods.includes(preferred) ? preferred : (methods[0] ?? preferred),
      viewerCanMerge: isOpen && access.canPush,
      defaultTitle: {
        merge: pullRequest.mergeHeadline,
        squash: pullRequest.squashHeadline,
        rebase: pullRequest.rebaseHeadline,
      },
      defaultMessage: {
        merge: pullRequest.mergeBody,
        squash: pullRequest.squashBody,
        rebase: pullRequest.rebaseBody,
      },
      canDeleteHeadBranch:
        access.writable && pullRequest.viewerCanDeleteHeadRef && pullRequest.headRef !== null,
    },
    viewerCan: {
      ...subject.viewerCan,
      updateBranch: canWrite && pullRequest.viewerCanUpdateBranch,
      markReady: canWrite && pullRequest.viewerCanUpdate,
    },
  };
}
