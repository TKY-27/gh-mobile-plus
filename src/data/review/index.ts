import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ResultOf } from "gql.tada";
import type { GitHubError } from "../errors";
import { apiPath, graphql } from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { restPages } from "../internal/pages";
import { PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { useActiveAccount, type AccountId } from "../session";
import type { Actor } from "../types";
import {
  markFileViewedMutation,
  pullFilesQuery,
  replyToThreadMutation,
  resolveThreadMutation,
  reviewThreadsQuery,
  unmarkFileViewedMutation,
  unresolveThreadMutation,
} from "./documents";
import { invalidatePullQueries, pullKey } from "./keys";
import { changedFileFrom, MAX_REVIEW_FILES, type ChangedFile, type RestDiffFile } from "./files";
import { suggestionFrom, type DiffSide } from "./patch";

export { MAX_REVIEW_FILES, type ChangedFile } from "./files";
export {
  anchorFor,
  canAnchorRange,
  parsePatch,
  rangeAnchor,
  suggestionBlock,
  type DiffHunk,
  type DiffLine,
  type DiffSide,
} from "./patch";
export { usePendingReview, type PendingComment, type PendingReview } from "./pending";
export {
  isStalePendingReviewConflict,
  StaleReviewDrafts,
  UnrecoverableReview,
  useCommitSuggestion,
  useDiscardPendingReview,
  useSubmitReview,
  type ReviewEvent,
} from "./submit";

export interface PullFiles {
  files: readonly ChangedFile[];
  truncated: boolean;
  totalFiles: number;
  headOid: string;
  baseOid: string;
}

export interface ReviewComment {
  id: string;
  author: Actor | null;
  bodyHtml: string;
  createdAt: string;
  suggestion: string | null;
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  side: DiffSide;
  isResolved: boolean;
  isOutdated: boolean;
  viewerCanResolve: boolean;
  comments: readonly ReviewComment[];
  /** First-page truncation requires a GitHub link. */
  hasMoreComments: boolean;
}

const FILES_PAGE_SIZE = 100;
const FILE_SNAPSHOT_ATTEMPTS = 2;
const VIEWED_STATE = {
  VIEWED: "viewed",
  UNVIEWED: "unviewed",
  DISMISSED: "dismissed",
} as const satisfies Record<string, ChangedFile["viewed"]>;

type ThreadNode = NonNullable<
  NonNullable<
    NonNullable<
      NonNullable<ResultOf<typeof reviewThreadsQuery>["repository"]>["pullRequest"]
    >["reviewThreads"]["nodes"]
  >[number]
>;

async function viewedStates(
  accountId: AccountId,
  owner: string,
  repo: string,
  number: number,
  signal: AbortSignal,
): Promise<{
  headOid: string;
  baseOid: string;
  totalFiles: number;
  viewed: Map<string, ChangedFile["viewed"]>;
}> {
  const viewed = new Map<string, ChangedFile["viewed"]>();
  let after: string | null = null;
  for (;;) {
    const result: ResultOf<typeof pullFilesQuery> = await graphql(
      accountId,
      pullFilesQuery,
      { owner, repo, number, after },
      signal,
    );
    const pull = result.repository?.pullRequest;
    if (!pull) throw gitHubFailure({ kind: "notFound" });
    for (const file of pull.files?.nodes ?? []) {
      if (file) viewed.set(file.path, VIEWED_STATE[file.viewerViewedState]);
    }
    const page = pull.files?.pageInfo;
    after = page?.hasNextPage ? page.endCursor : null;
    if (after === null || viewed.size >= MAX_REVIEW_FILES) {
      return {
        headOid: pull.headRefOid,
        baseOid: pull.baseRefOid,
        totalFiles: pull.changedFiles,
        viewed,
      };
    }
  }
}

export function usePullFiles(
  owner: string,
  repo: string,
  number: number,
): UseQueryResult<PullFiles> {
  const accountId = useActiveAccount().id;
  return useQuery<PullFiles>({
    queryKey: pullKey(accountId, "pullFiles", owner, repo, number),
    staleTime: (query) => (query.state.data?.baseOid ? STALE_TIME.detail : 0),
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal, client, queryKey }): Promise<PullFiles> => {
      let expected: Pick<PullFiles, "headOid" | "baseOid"> | undefined =
        client.getQueryData<PullFiles>(queryKey);
      if (!expected?.baseOid) {
        const first = await graphql(
          accountId,
          pullFilesQuery,
          { owner, repo, number, after: null },
          signal,
        );
        if (!first.repository?.pullRequest) throw gitHubFailure({ kind: "notFound" });
        const { headRefOid, baseRefOid } = first.repository.pullRequest;
        expected = { headOid: headRefOid, baseOid: baseRefOid };
      }
      for (let attempt = 0; attempt < FILE_SNAPSHOT_ATTEMPTS; attempt++) {
        const pages = await restPages<RestDiffFile[]>(
          accountId,
          {
            path: apiPath`/repos/${owner}/${repo}/pulls/${number}/files`,
            query: { per_page: FILES_PAGE_SIZE },
            revalidate: true,
            signal,
          },
          MAX_REVIEW_FILES / FILES_PAGE_SIZE,
        );
        // REST patches lack a review commit.
        const state = await viewedStates(accountId, owner, repo, number, signal);
        if (state.headOid === expected.headOid && state.baseOid === expected.baseOid) {
          return {
            files: pages
              .flat()
              .slice(0, MAX_REVIEW_FILES)
              .map((file) => changedFileFrom(file, state.viewed.get(file.filename) ?? "unviewed")),
            truncated: state.totalFiles > MAX_REVIEW_FILES,
            totalFiles: state.totalFiles,
            headOid: state.headOid,
            baseOid: state.baseOid,
          };
        }
        expected = state;
      }
      throw gitHubFailure({ kind: "conflict", message: "Diff changed while loading patches" });
    },
  });
}

export function useSetFileViewed(): UseMutationResult<
  void,
  GitHubError,
  {
    pullRequestId: string;
    owner: string;
    repo: string;
    number: number;
    path: string;
    viewed: boolean;
  }
> {
  const accountId = useActiveAccount().id;
  const client = useQueryClient();
  const setViewed = (
    { owner, repo, number, path }: { owner: string; repo: string; number: number; path: string },
    viewed: ChangedFile["viewed"],
  ): void => {
    client.setQueryData<PullFiles>(
      pullKey(accountId, "pullFiles", owner, repo, number),
      (pullFiles) =>
        pullFiles && {
          ...pullFiles,
          files: pullFiles.files.map((file) => (file.path === path ? { ...file, viewed } : file)),
        },
    );
  };
  return useMutation({
    retry: false,
    mutationFn: async ({ pullRequestId, path, viewed }) => {
      const input = { pullRequestId, path };
      if (viewed) await graphql(accountId, markFileViewedMutation, { input });
      else await graphql(accountId, unmarkFileViewedMutation, { input });
    },
    onMutate: async (variables) => {
      const queryKey = pullKey(
        accountId,
        "pullFiles",
        variables.owner,
        variables.repo,
        variables.number,
      );
      await client.cancelQueries({ queryKey });
      const previous = client
        .getQueryData<PullFiles>(queryKey)
        ?.files.find((file) => file.path === variables.path)?.viewed;
      setViewed(variables, variables.viewed ? "viewed" : "unviewed");
      return { previous };
    },
    // Per file, so concurrent toggles survive.
    onError: (_error, variables, context) => {
      if (context?.previous) setViewed(variables, context.previous);
    },
    // Refetching would download every patch again.
    onSettled: (_data, _error, { owner, repo, number }) =>
      client.invalidateQueries({
        queryKey: pullKey(accountId, "pullFiles", owner, repo, number),
        refetchType: "none",
      }),
  });
}

function threadFrom(thread: ThreadNode): ReviewThread {
  return {
    id: thread.id,
    path: thread.path,
    line: thread.line,
    startLine: thread.startLine,
    side: thread.diffSide,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    viewerCanResolve: thread.isResolved ? thread.viewerCanUnresolve : thread.viewerCanResolve,
    comments: (thread.comments.nodes ?? []).flatMap((comment) =>
      comment
        ? [
            {
              id: comment.id,
              author: comment.author && {
                login: comment.author.login,
                avatarUrl: comment.author.avatarUrl,
              },
              bodyHtml: comment.bodyHTML,
              createdAt: comment.createdAt,
              suggestion: suggestionFrom(comment.body),
            },
          ]
        : [],
    ),
    hasMoreComments: thread.comments.pageInfo.hasNextPage,
  };
}

export function useReviewThreads(
  owner: string,
  repo: string,
  number: number,
): UseQueryResult<readonly ReviewThread[]> {
  const accountId = useActiveAccount().id;
  return useQuery({
    queryKey: pullKey(accountId, "reviewThreads", owner, repo, number),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const threads: ReviewThread[] = [];
      let after: string | null = null;
      do {
        const result: ResultOf<typeof reviewThreadsQuery> = await graphql(
          accountId,
          reviewThreadsQuery,
          { owner, repo, number, after },
          signal,
        );
        const connection = result.repository?.pullRequest?.reviewThreads;
        if (!connection) throw gitHubFailure({ kind: "notFound" });
        for (const thread of connection.nodes ?? []) if (thread) threads.push(threadFrom(thread));
        after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (after !== null);
      return threads;
    },
  });
}

interface ThreadTarget {
  threadId: string;
  owner: string;
  repo: string;
  number: number;
}

export function useResolveThread(): UseMutationResult<
  void,
  GitHubError,
  ThreadTarget & { resolved: boolean }
> {
  const accountId = useActiveAccount().id;
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ threadId, resolved }) => {
      const input = { threadId };
      if (resolved) await graphql(accountId, resolveThreadMutation, { input });
      else await graphql(accountId, unresolveThreadMutation, { input });
    },
    onMutate: async ({ threadId, owner, repo, number, resolved }) => {
      const queryKey = pullKey(accountId, "reviewThreads", owner, repo, number);
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<readonly ReviewThread[]>(queryKey);
      client.setQueryData<readonly ReviewThread[]>(queryKey, (threads) =>
        threads?.map((thread) =>
          thread.id === threadId ? { ...thread, isResolved: resolved } : thread,
        ),
      );
      return { previous };
    },
    onError: (_error, { owner, repo, number }, context) => {
      client.setQueryData(
        pullKey(accountId, "reviewThreads", owner, repo, number),
        context?.previous,
      );
    },
    onSettled: (_data, _error, { owner, repo, number }) =>
      client.invalidateQueries({
        queryKey: pullKey(accountId, "reviewThreads", owner, repo, number),
      }),
  });
}

export function useReplyToThread(): UseMutationResult<
  void,
  GitHubError,
  ThreadTarget & { body: string }
> {
  const accountId = useActiveAccount().id;
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ threadId, body }) => {
      const result = await graphql(accountId, replyToThreadMutation, {
        input: { pullRequestReviewThreadId: threadId, body },
      });
      if (!result.addPullRequestReviewThreadReply?.comment) {
        throw gitHubFailure({ kind: "server", status: 200 });
      }
    },
    onSuccess: (_data, { owner, repo, number }) =>
      invalidatePullQueries(client, accountId, owner, repo, number),
  });
}
