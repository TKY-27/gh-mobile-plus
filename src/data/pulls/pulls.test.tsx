import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import assignableUsers from "../issues/fixtures/assignable-users.json";
import { useAssignableUsers, useIssue, useTimeline } from "../issues";
import { property } from "../internal/json";
import { installBrowserDoubles } from "../internal/test-doubles";
import {
  type MergeResult,
  useChecks,
  useMergePullRequest,
  usePullCommits,
  usePullRequest,
  useRequestReviewers,
  useSetDraft,
  useUpdateBranch,
} from ".";
import checks from "./fixtures/checks.json";
import commits from "./fixtures/commits.json";
import merge from "./fixtures/merge.json";
import mergeStates from "./fixtures/merge-states.json";
import mergedTimeline from "./fixtures/merged-timeline.json";
import pullRequest from "./fixtures/pull-request.json";

vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 7, login: "mona" }) }));

const OWNER = "octo-org";
const REPO = "hello-mobile";
const PULL_ID = "PR_kwDOJx1cRc5vX9aB";
const HEAD_OID = "e5bd3914e2e596debea16f433f57875b5b90bcd6";

interface SentOperation {
  operation: string;
  variables: unknown;
}
type Responder = (variables: unknown) => JsonBodyType | Promise<JsonBodyType>;

const sent: SentOperation[] = [];
let responders: Record<string, Responder> = {};
const ok: Responder = () => ({ data: {} });

const server = setupServer(
  http.post("/auth/token", () => HttpResponse.json({ accessToken: "gho_test", expiresAt: null })),
  http.post("https://api.github.com/graphql", async ({ request }) => {
    const body: unknown = await request.json();
    const query = String(property(body, "query"));
    const operation = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? "";
    const variables = property(body, "variables");
    sent.push({ operation, variables });
    const responder = responders[operation];
    if (!responder) throw new Error(`Unexpected operation ${operation}`);
    return HttpResponse.json(responder(variables));
  }),
);

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function operations(): string[] {
  return sent.map((entry) => entry.operation);
}

function variablesOf(operation: string): unknown[] {
  return sent.filter((entry) => entry.operation === operation).map((entry) => entry.variables);
}

function pullRequestWith(fields: Record<string, unknown>): JsonBodyType {
  const response = structuredClone(pullRequest);
  Object.assign(response.data.repository.issueOrPullRequest, fields);
  return response;
}

beforeAll(() => {
  installBrowserDoubles();
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sent.length = 0;
  responders = {
    Conversation: () => pullRequest,
    AssignableUsers: () => assignableUsers,
  };
});
afterEach(() => {
  cleanup();
  client.clear();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

async function loadedPullRequest() {
  const hook = renderHook(() => usePullRequest(OWNER, REPO, 43), { wrapper });
  await waitFor(() => {
    expect(hook.result.current.isSuccess).toBe(true);
  });
  sent.length = 0;
  return hook;
}

describe("pull request detail", () => {
  it("maps header, reviews and merge settings from the conversation request", async () => {
    const { result } = renderHook(
      () => ({
        pull: usePullRequest(OWNER, REPO, 43),
        timeline: useTimeline(OWNER, REPO, 43),
        issue: useIssue(OWNER, REPO, 43),
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.pull.isSuccess && result.current.timeline.isSuccess).toBe(true);
    });
    expect(operations()).toEqual(["Conversation"]);
    expect(result.current.issue.error?.kind).toBe("notFound");
    expect(result.current.pull.data).toMatchObject({
      id: PULL_ID,
      number: 43,
      state: "open",
      isDraft: false,
      baseRef: "main",
      headRef: "mona/offline-cache",
      headRepo: { owner: OWNER, name: REPO },
      headOid: HEAD_OID,
      additions: 182,
      deletions: 24,
      changedFiles: 6,
      commitsCount: 3,
      reviewDecision: "changesRequested",
      requestedReviewers: [
        { login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4" },
        { team: "octo-org/mobile-reviewers" },
      ],
      latestReviews: [
        {
          author: {
            login: "hubot",
            avatarUrl: "https://avatars.githubusercontent.com/u/480938?v=4",
          },
          state: "changesRequested",
        },
        {
          author: {
            login: "octocat",
            avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
          },
          state: "commented",
        },
      ],
      checks: "failure",
      viewerCan: {
        update: true,
        close: true,
        lock: true,
        react: true,
        comment: true,
        updateBranch: false,
        markReady: true,
      },
    });
    expect(result.current.pull.data?.merge).toEqual({
      mergeable: "mergeable",
      state: "blocked",
      blockedReasons: ["changesRequested", "checksFailing"],
      allowedMethods: ["squash", "merge"],
      defaultMethod: "squash",
      viewerCanMerge: true,
      defaultTitle: {
        merge: "Merge pull request #43 from octo-org/mona/offline-cache",
        squash: "Cache notifications for offline mode (#43)",
        rebase: "",
      },
      defaultMessage: {
        merge: "Cache notifications for offline mode",
        squash:
          "* Store notification pages in IndexedDB\n\n* Read cached page when offline\n\n* Add offline banner",
        rebase: "",
      },
      canDeleteHeadBranch: true,
    });
    const items = result.current.timeline.data?.pages[0]?.items ?? [];
    expect(items.map((entry) => entry.kind)).toEqual(["commit", "labeled", "review", "comment"]);
    expect(items[0]).toEqual({
      kind: "commit",
      id: "PURC_lADOJx1cRc5vX9aB2gAoNmRjYjA5YjU",
      oid: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
      headline: "Store notification pages in IndexedDB",
      author: { login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
      createdAt: "2026-11-04T09:10:00Z",
    });
    expect(items[2]).toMatchObject({
      state: "changesRequested",
      createdAt: "2026-11-05T08:05:00Z",
    });
  });

  it("maps a merged pull request timeline page", async () => {
    responders.Conversation = () =>
      pullRequestWith({
        timelineItems: {
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          nodes: [],
        },
      });
    responders.TimelinePage = () => mergedTimeline;
    const { result } = renderHook(() => useTimeline(OWNER, REPO, 43), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.pages).toEqual([{ items: [], nextCursor: "cursor-1" }]);
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => {
      expect(result.current.data?.pages[1]?.items.map((entry) => entry.kind)).toEqual([
        "review",
        "merged",
        "closed",
      ]);
    });
    expect(variablesOf("TimelinePage")).toEqual([
      { owner: OWNER, repo: REPO, number: 43, cursor: "cursor-1" },
    ]);
  });

  it.each(Object.entries(mergeStates))(
    "derives blocked reasons for %s",
    async (_scenario, { fields, blockedReasons }) => {
      responders.Conversation = () => pullRequestWith(fields);
      const { result } = renderHook(() => usePullRequest(OWNER, REPO, 43), { wrapper });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data?.merge.blockedReasons).toEqual(blockedReasons);
    },
  );

  it("disables every write for an archived repository", async () => {
    responders.Conversation = () => {
      const response = structuredClone(pullRequest);
      response.data.repository.isArchived = true;
      Object.assign(response.data.repository.issueOrPullRequest, {
        viewerCanUpdateBranch: true,
      });
      return response;
    };
    const { result } = renderHook(() => usePullRequest(OWNER, REPO, 43), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.merge).toMatchObject({
      viewerCanMerge: false,
      canDeleteHeadBranch: false,
    });
    expect(result.current.data?.viewerCan).toEqual({
      update: false,
      close: true,
      lock: false,
      react: true,
      comment: false,
      updateBranch: false,
      markReady: false,
    });
  });

  it("disables merging for readers and closed pull requests", async () => {
    responders.Conversation = () => {
      const response = structuredClone(pullRequest);
      response.data.repository.viewerPermission = "READ";
      return response;
    };
    const { result } = renderHook(() => usePullRequest(OWNER, REPO, 43), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.merge.viewerCanMerge).toBe(false);
    expect(result.current.data?.viewerCan.lock).toBe(false);
  });
});

describe("checks and commits", () => {
  it("groups check runs by suite and links Actions jobs", async () => {
    responders.PullRequestChecks = () => checks;
    const { result } = renderHook(() => useChecks(OWNER, REPO, 43), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const suites = result.current.data?.suites ?? [];
    expect(suites.map((suite) => [suite.app, suite.workflowName, suite.runs.length])).toEqual([
      ["GitHub Actions", "CI", 2],
      ["GitHub Actions", "End-to-end", 1],
      ["Codecov", null, 1],
    ]);
    expect(suites[0]?.runs[1]).toEqual({
      id: "CR_kwDOJx1cRc8AAAAHNl1aB2",
      name: "test (ubuntu-latest)",
      status: "completed",
      conclusion: "failure",
      startedAt: "2026-11-04T09:11:05Z",
      completedAt: "2026-11-04T09:16:40Z",
      detailsUrl:
        "https://github.com/octo-org/hello-mobile/actions/runs/12000000001/job/31000000002",
      actionsJob: { runId: 12000000001, jobId: 31000000002 },
    });
    expect(suites[1]?.runs[0]).toMatchObject({ status: "inProgress", conclusion: null });
    expect(suites[2]?.runs[0]).toMatchObject({ conclusion: "neutral", actionsJob: null });
    expect(result.current.data?.statuses).toEqual([
      {
        context: "ci/circleci: deploy-preview",
        state: "pending",
        targetUrl: "https://circleci.com/gh/octo-org/hello-mobile/1234",
        description: "Your tests are queued behind your running builds",
      },
    ]);
  });

  it("follows the checks cursor until the last page", async () => {
    const firstPage = structuredClone(checks);
    firstPage.data.repository.pullRequest.statusCheckRollup.contexts.pageInfo = {
      hasNextPage: true,
      endCursor: "checks-cursor",
    };
    responders.PullRequestChecks = (variables) =>
      property(variables, "cursor") === null ? firstPage : checks;
    const { result } = renderHook(() => useChecks(OWNER, REPO, 43), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(
      variablesOf("PullRequestChecks").map((variables) => property(variables, "cursor")),
    ).toEqual([null, "checks-cursor"]);
    expect(result.current.data?.statuses).toHaveLength(2);
  });

  it("maps commits with their check state and pages by cursor", async () => {
    responders.PullRequestCommits = () => commits;
    const { result } = renderHook(() => usePullCommits(OWNER, REPO, 43), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items).toEqual([
      {
        oid: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
        headline: "Store notification pages in IndexedDB",
        author: { login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
        committedAt: "2026-11-04T09:10:00Z",
        checks: "success",
      },
      {
        oid: "7ac1d2f0e4b9a3c5d6e7f8091a2b3c4d5e6f7a8b",
        headline: "Read cached page when offline",
        author: null,
        committedAt: "2026-11-04T11:40:00Z",
        checks: "failure",
      },
    ]);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(variablesOf("PullRequestCommits")[1]).toMatchObject({ cursor: "Mw", count: 50 });
  });
});

describe("pull request mutations", () => {
  const mergeVariables = {
    pullRequestId: PULL_ID,
    owner: OWNER,
    repo: REPO,
    number: 43,
    method: "merge",
    title: "Merge pull request #43",
    message: "",
    expectedHeadOid: HEAD_OID,
    deleteBranch: true,
  } as const;

  it("squash merges with the edited message, then deletes the head branch", async () => {
    await loadedPullRequest();
    responders.MergePullRequest = () => merge;
    responders.DeleteRef = ok;
    const { result } = renderHook(() => useMergePullRequest(), { wrapper });
    let outcome: MergeResult | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        pullRequestId: PULL_ID,
        owner: OWNER,
        repo: REPO,
        number: 43,
        method: "squash",
        title: "Cache notifications offline (#43)",
        message: "Adds an IndexedDB cache.",
        expectedHeadOid: HEAD_OID,
        deleteBranch: true,
      });
    });
    expect(operations().slice(0, 2)).toEqual(["MergePullRequest", "DeleteRef"]);
    expect(variablesOf("MergePullRequest")).toEqual([
      {
        id: PULL_ID,
        method: "SQUASH",
        headline: "Cache notifications offline (#43)",
        body: "Adds an IndexedDB cache.",
        expectedHeadOid: HEAD_OID,
      },
    ]);
    expect(variablesOf("DeleteRef")).toEqual([{ id: "REF_kwDOJx1cRc_bW9uYS9vZmZsaW5lLWNhY2hl" }]);
    expect(outcome).toEqual({ branchDeleted: true, branchDeleteError: null });
    expect(operations()).toContain("Conversation");
  });

  it("rebases without a commit message and keeps the branch", async () => {
    await loadedPullRequest();
    responders.MergePullRequest = () => merge;
    const { result } = renderHook(() => useMergePullRequest(), { wrapper });
    let outcome: MergeResult | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        pullRequestId: PULL_ID,
        owner: OWNER,
        repo: REPO,
        number: 43,
        method: "rebase",
        title: "ignored",
        message: "ignored",
        expectedHeadOid: HEAD_OID,
        deleteBranch: false,
      });
    });
    expect(variablesOf("MergePullRequest")).toEqual([
      { id: PULL_ID, method: "REBASE", expectedHeadOid: HEAD_OID },
    ]);
    expect(operations()).not.toContain("DeleteRef");
    expect(outcome).toEqual({ branchDeleted: false, branchDeleteError: null });
  });

  it("reports a failed branch delete without failing the merge", async () => {
    await loadedPullRequest();
    responders.MergePullRequest = () => merge;
    responders.DeleteRef = () => ({
      errors: [{ type: "FORBIDDEN", message: "Cannot delete protected branch" }],
    });
    const { result } = renderHook(() => useMergePullRequest(), { wrapper });
    let outcome: MergeResult | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync(mergeVariables);
    });
    expect(outcome).toMatchObject({
      branchDeleted: false,
      branchDeleteError: { kind: "forbidden", message: "Cannot delete protected branch" },
    });
    expect(variablesOf("MergePullRequest")).toHaveLength(1);
  });

  it("reports a missing head branch instead of skipping the delete", async () => {
    await loadedPullRequest();
    responders.MergePullRequest = () => ({
      data: { mergePullRequest: { pullRequest: { headRef: null } } },
    });
    const { result } = renderHook(() => useMergePullRequest(), { wrapper });
    let outcome: MergeResult | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync(mergeVariables);
    });
    expect(outcome).toEqual({
      branchDeleted: false,
      branchDeleteError: { kind: "notFound" },
    });
    expect(operations()).not.toContain("DeleteRef");
  });

  it("does not delete the branch when the merge fails", async () => {
    await loadedPullRequest();
    responders.MergePullRequest = () => ({
      errors: [{ type: "STALE_DATA", message: "Head branch was modified" }],
    });
    const { result } = renderHook(() => useMergePullRequest(), { wrapper });
    act(() => {
      result.current.mutate({
        pullRequestId: PULL_ID,
        owner: OWNER,
        repo: REPO,
        number: 43,
        method: "merge",
        title: "Merge",
        message: "",
        expectedHeadOid: "0000000000000000000000000000000000000000",
        deleteBranch: true,
      });
    });
    await waitFor(() => {
      expect(result.current.error?.kind).toBe("conflict");
    });
    expect(operations()).not.toContain("DeleteRef");
    expect(variablesOf("MergePullRequest")).toHaveLength(1);
  });

  it("requests reviewers by node id, looking up logins outside the picker", async () => {
    await loadedPullRequest();
    const picker = renderHook(() => useAssignableUsers(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(picker.result.current.isSuccess).toBe(true);
    });
    responders.ReviewerId = () => ({ data: { user: { id: "U_kgDOAAAAZw" } } });
    responders.RequestReviews = ok;
    const { result } = renderHook(() => useRequestReviewers(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        pullRequestId: PULL_ID,
        owner: OWNER,
        repo: REPO,
        number: 43,
        logins: ["octocat", "Hubot", "newcomer"],
      });
    });
    expect(variablesOf("ReviewerId")).toEqual([{ login: "newcomer" }]);
    expect(variablesOf("RequestReviews")).toEqual([
      {
        id: PULL_ID,
        userIds: ["MDQ6VXNlcjU4MzIzMQ==", "MDQ6VXNlcjQ4MDkzOA==", "U_kgDOAAAAZw"],
      },
    ]);
  });

  it("rejects reviewers that cannot be resolved", async () => {
    await loadedPullRequest();
    responders.ReviewerId = () => ({ data: { user: null } });
    const { result } = renderHook(() => useRequestReviewers(), { wrapper });
    act(() => {
      result.current.mutate({
        pullRequestId: PULL_ID,
        owner: OWNER,
        repo: REPO,
        number: 43,
        logins: ["ghost"],
      });
    });
    await waitFor(() => {
      expect(result.current.error).toMatchObject({ kind: "validation", fields: ["logins"] });
    });
    expect(operations()).not.toContain("RequestReviews");
  });

  it("converts to draft and updates the branch with the expected head", async () => {
    await loadedPullRequest();
    responders.ConvertToDraft = ok;
    responders.MarkReadyForReview = ok;
    responders.UpdateBranch = ok;
    const { result } = renderHook(() => ({ draft: useSetDraft(), update: useUpdateBranch() }), {
      wrapper,
    });
    const target = { pullRequestId: PULL_ID, owner: OWNER, repo: REPO, number: 43 };
    await act(async () => {
      await result.current.draft.mutateAsync({ ...target, draft: true });
      await result.current.draft.mutateAsync({ ...target, draft: false });
      await result.current.update.mutateAsync({ ...target, expectedHeadOid: HEAD_OID });
    });
    expect(variablesOf("ConvertToDraft")).toEqual([{ id: PULL_ID }]);
    expect(variablesOf("MarkReadyForReview")).toEqual([{ id: PULL_ID }]);
    expect(variablesOf("UpdateBranch")).toEqual([{ id: PULL_ID, expectedHeadOid: HEAD_OID }]);
  });
});
