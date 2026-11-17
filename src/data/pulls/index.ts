import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ResultOf } from "gql.tada";
import { isGitHubError, type GitHubError } from "../errors";
import { graphql as requestGraphQL } from "../internal/client";
import { nodesOf } from "../internal/connection";
import { gitHubFailure } from "../internal/errors";
import { graphql } from "../internal/graphql";
import { checksState } from "../internal/subject-status";
import { PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import {
  conversationOptions,
  useConversationMutation,
  type Conversation,
} from "../issues/conversation";
import { assignableOptions, idsByName, resolveIds, subjectKey } from "../issues/repository-options";
import type { MergeMethod } from "../repo";
import { useActiveAccount, type AccountId } from "../session";
import type { Actor, ChecksState, Page } from "../types";
import type { PullRequestDetail } from "./detail";

export type { MergeBlockedReason, PullRequestDetail } from "./detail";

export interface CheckRun {
  id: string;
  name: string;
  status: "queued" | "inProgress" | "completed" | "waiting" | "pending";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timedOut"
    | "actionRequired"
    | "stale"
    | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  actionsJob: { runId: number; jobId: number } | null;
}
export interface CheckSuiteGroup {
  app: string;
  workflowName: string | null;
  runs: readonly CheckRun[];
}
export interface StatusContext {
  context: string;
  state: "success" | "failure" | "pending" | "error" | "expected";
  targetUrl: string | null;
  description: string | null;
}
export interface PullCommit {
  oid: string;
  headline: string;
  author: Actor | null;
  committedAt: string;
  checks: ChecksState;
}

const CHECKS_PAGE_SIZE = 100;
const COMMITS_PAGE_SIZE = 50;
const ACTIONS_APP_SLUG = "github-actions";

const checksDocument = graphql(`
  query PullRequestChecks(
    $owner: String!
    $repo: String!
    $number: Int!
    $cursor: String
    $count: Int!
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        statusCheckRollup {
          contexts(first: $count, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              __typename
              ... on CheckRun {
                id
                databaseId
                name
                status
                conclusion
                startedAt
                completedAt
                detailsUrl
                checkSuite {
                  id
                  app {
                    name
                    slug
                  }
                  workflowRun {
                    databaseId
                    workflow {
                      name
                    }
                  }
                }
              }
              ... on StatusContext {
                context
                state
                targetUrl
                description
              }
            }
          }
        }
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`);

const commitsDocument = graphql(`
  query PullRequestCommits(
    $owner: String!
    $repo: String!
    $number: Int!
    $cursor: String
    $count: Int!
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        commits(first: $count, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            commit {
              oid
              messageHeadline
              committedDate
              author {
                user {
                  login
                  avatarUrl
                }
              }
              statusCheckRollup {
                state
              }
            }
          }
        }
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`);

const requestReviewsDocument = graphql(`
  mutation RequestReviews($id: ID!, $userIds: [ID!]!) {
    requestReviews(input: { pullRequestId: $id, userIds: $userIds, union: true }) {
      clientMutationId
    }
  }
`);

const mergeDocument = graphql(`
  mutation MergePullRequest(
    $id: ID!
    $method: PullRequestMergeMethod!
    $headline: String
    $body: String
    $expectedHeadOid: GitObjectID!
  ) {
    mergePullRequest(
      input: {
        pullRequestId: $id
        mergeMethod: $method
        commitHeadline: $headline
        commitBody: $body
        expectedHeadOid: $expectedHeadOid
      }
    ) {
      pullRequest {
        headRef {
          id
        }
      }
    }
  }
`);

const reviewerDocument = graphql(`
  query ReviewerId($login: String!) {
    user(login: $login) {
      id
    }
  }
`);

const deleteRefDocument = graphql(`
  mutation DeleteRef($id: ID!) {
    deleteRef(input: { refId: $id }) {
      clientMutationId
    }
  }
`);

const readyForReviewDocument = graphql(`
  mutation MarkReadyForReview($id: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`);

const convertToDraftDocument = graphql(`
  mutation ConvertToDraft($id: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`);

const updateBranchDocument = graphql(`
  mutation UpdateBranch($id: ID!, $expectedHeadOid: GitObjectID!) {
    updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $expectedHeadOid }) {
      clientMutationId
    }
  }
`);

type ChecksResponse = ResultOf<typeof checksDocument>;
type RollupContext = NonNullable<
  NonNullable<
    NonNullable<NonNullable<ChecksResponse["repository"]>["pullRequest"]>["statusCheckRollup"]
  >["contexts"]["nodes"]
>[number];
type CheckRunNode = Extract<NonNullable<RollupContext>, { __typename: "CheckRun" }>;

const CHECK_STATUSES = {
  COMPLETED: "completed",
  IN_PROGRESS: "inProgress",
  PENDING: "pending",
  QUEUED: "queued",
  REQUESTED: "queued",
  WAITING: "waiting",
} as const;
const CHECK_CONCLUSIONS = {
  ACTION_REQUIRED: "actionRequired",
  CANCELLED: "cancelled",
  FAILURE: "failure",
  NEUTRAL: "neutral",
  SKIPPED: "skipped",
  STALE: "stale",
  STARTUP_FAILURE: "failure",
  SUCCESS: "success",
  TIMED_OUT: "timedOut",
} as const;
const STATUS_STATES = {
  ERROR: "error",
  EXPECTED: "expected",
  FAILURE: "failure",
  PENDING: "pending",
  SUCCESS: "success",
} as const;
const MERGE_METHODS = { merge: "MERGE", squash: "SQUASH", rebase: "REBASE" } as const;

function mapCheckRun(run: CheckRunNode): CheckRun {
  const workflowRunId = run.checkSuite.workflowRun?.databaseId;
  const isActions = run.checkSuite.app?.slug === ACTIONS_APP_SLUG;
  return {
    id: run.id,
    name: run.name,
    status: CHECK_STATUSES[run.status],
    conclusion: run.conclusion ? CHECK_CONCLUSIONS[run.conclusion] : null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    detailsUrl: run.detailsUrl,
    // Actions check run ids are job ids.
    actionsJob:
      isActions && workflowRunId != null && run.databaseId !== null
        ? { runId: workflowRunId, jobId: run.databaseId }
        : null,
  };
}

export function groupChecks(contexts: readonly RollupContext[]): {
  suites: CheckSuiteGroup[];
  statuses: StatusContext[];
} {
  const suites = new Map<string, { app: string; workflowName: string | null; runs: CheckRun[] }>();
  const statuses: StatusContext[] = [];
  for (const context of contexts) {
    if (context?.__typename === "StatusContext") {
      statuses.push({
        context: context.context,
        state: STATUS_STATES[context.state],
        targetUrl: context.targetUrl,
        description: context.description,
      });
    }
    if (context?.__typename !== "CheckRun") continue;
    const suite = suites.get(context.checkSuite.id) ?? {
      app: context.checkSuite.app?.name ?? "",
      workflowName: context.checkSuite.workflowRun?.workflow.name ?? null,
      runs: [],
    };
    suite.runs.push(mapCheckRun(context));
    suites.set(context.checkSuite.id, suite);
  }
  return { suites: [...suites.values()], statuses };
}

function selectPullRequest(conversation: Conversation): PullRequestDetail {
  if (conversation.kind !== "pullRequest") throw gitHubFailure({ kind: "notFound" });
  return conversation.detail;
}

export function usePullRequest(
  owner: string,
  repo: string,
  number: number,
): UseQueryResult<PullRequestDetail> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useQuery({
    ...conversationOptions(account.id, queryClient, owner, repo, number),
    select: selectPullRequest,
  });
}

export function useChecks(
  owner: string,
  repo: string,
  number: number,
): UseQueryResult<{ suites: readonly CheckSuiteGroup[]; statuses: readonly StatusContext[] }> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: subjectKey(account.id, "checks", owner, repo, number),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const contexts: RollupContext[] = [];
      let cursor: string | null = null;
      do {
        const response: ChecksResponse = await requestGraphQL(
          account.id,
          checksDocument,
          { owner, repo, number, cursor, count: CHECKS_PAGE_SIZE },
          signal,
        );
        const pullRequest = response.repository?.pullRequest;
        if (!pullRequest) throw gitHubFailure({ kind: "notFound" });
        const connection = pullRequest.statusCheckRollup?.contexts;
        contexts.push(...(connection?.nodes ?? []));
        cursor = connection?.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (cursor !== null);
      return groupChecks(contexts);
    },
  });
}

export function usePullCommits(
  owner: string,
  repo: string,
  number: number,
): UseInfiniteQueryResult<InfiniteData<Page<PullCommit>>> {
  const account = useActiveAccount();
  return useInfiniteQuery({
    queryKey: subjectKey(account.id, "pullCommits", owner, repo, number),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page<PullCommit>> => {
      const response = await requestGraphQL(
        account.id,
        commitsDocument,
        { owner, repo, number, cursor: pageParam, count: COMMITS_PAGE_SIZE },
        signal,
      );
      const commits = response.repository?.pullRequest?.commits;
      if (!commits) throw gitHubFailure({ kind: "notFound" });
      return {
        items: nodesOf(commits).map(({ commit }) => ({
          oid: commit.oid,
          headline: commit.messageHeadline,
          author: commit.author?.user ?? null,
          committedAt: commit.committedDate,
          checks: checksState(commit.statusCheckRollup?.state),
        })),
        nextCursor: commits.pageInfo.hasNextPage ? commits.pageInfo.endCursor : null,
      };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

async function reviewerIds(
  accountId: AccountId,
  known: ReadonlyMap<string, string>,
  logins: readonly string[],
): Promise<string[]> {
  const lookups = await Promise.all(
    logins.map(async (login): Promise<readonly [string, string | null]> => {
      const cached = known.get(login.toLowerCase());
      if (cached) return [login, cached];
      const response = await requestGraphQL(accountId, reviewerDocument, { login });
      return [login, response.user?.id ?? null];
    }),
  );
  const resolved = new Map(
    lookups.flatMap(([login, id]) => (id ? [[login.toLowerCase(), id]] : [])),
  );
  return resolveIds(resolved, logins, "logins");
}

export function useRequestReviewers(): UseMutationResult<
  void,
  GitHubError,
  { pullRequestId: string; owner: string; repo: string; number: number; logins: readonly string[] }
> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useConversationMutation({
    subjectId: (variables) => variables.pullRequestId,
    mutationFn: async ({ pullRequestId, owner, repo, logins }) => {
      const assignable = queryClient.getQueryData(
        assignableOptions(account.id, owner, repo).queryKey,
      );
      const known = idsByName(assignable ?? [], (user) => user.login);
      const userIds = await reviewerIds(account.id, known, logins);
      await requestGraphQL(account.id, requestReviewsDocument, { id: pullRequestId, userIds });
    },
  });
}

export interface MergeResult {
  branchDeleted: boolean;
  branchDeleteError: GitHubError | null;
}

const KEPT_BRANCH: MergeResult = { branchDeleted: false, branchDeleteError: null };

async function deleteHeadBranch(accountId: AccountId, headRefId: string | undefined) {
  // Deleted or hidden refs lack IDs.
  if (!headRefId) return { branchDeleted: false, branchDeleteError: { kind: "notFound" } } as const;
  try {
    await requestGraphQL(accountId, deleteRefDocument, { id: headRefId });
    return { branchDeleted: true, branchDeleteError: null };
  } catch (error) {
    // Deletion failures must preserve merge success.
    if (!isGitHubError(error)) throw error;
    return { branchDeleted: false, branchDeleteError: error };
  }
}

export function useMergePullRequest(): UseMutationResult<
  MergeResult,
  GitHubError,
  {
    pullRequestId: string;
    owner: string;
    repo: string;
    number: number;
    method: MergeMethod;
    title: string;
    message: string;
    expectedHeadOid: string;
    deleteBranch: boolean;
  }
> {
  const account = useActiveAccount();
  return useConversationMutation({
    subjectId: (variables) => variables.pullRequestId,
    affectsLists: true,
    mutationFn: async ({
      pullRequestId,
      method,
      title,
      message,
      expectedHeadOid,
      deleteBranch,
    }) => {
      const common = { id: pullRequestId, method: MERGE_METHODS[method], expectedHeadOid };
      // Rebase merges have no commit message.
      const variables =
        method === "rebase" ? common : { ...common, headline: title, body: message };
      const response = await requestGraphQL(account.id, mergeDocument, variables);
      if (!deleteBranch) return KEPT_BRANCH;
      return deleteHeadBranch(account.id, response.mergePullRequest?.pullRequest?.headRef?.id);
    },
  });
}

export function useSetDraft(): UseMutationResult<
  void,
  GitHubError,
  { pullRequestId: string; owner: string; repo: string; number: number; draft: boolean }
> {
  const account = useActiveAccount();
  return useConversationMutation({
    subjectId: (variables) => variables.pullRequestId,
    mutationFn: async ({ pullRequestId: id, draft }) => {
      await (draft
        ? requestGraphQL(account.id, convertToDraftDocument, { id })
        : requestGraphQL(account.id, readyForReviewDocument, { id }));
    },
  });
}

export function useUpdateBranch(): UseMutationResult<
  void,
  GitHubError,
  { pullRequestId: string; owner: string; repo: string; number: number; expectedHeadOid: string }
> {
  const account = useActiveAccount();
  return useConversationMutation({
    subjectId: (variables) => variables.pullRequestId,
    mutationFn: async ({ pullRequestId: id, expectedHeadOid }) => {
      await requestGraphQL(account.id, updateBranchDocument, { id, expectedHeadOid });
    },
  });
}
