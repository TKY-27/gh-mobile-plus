import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { property } from "../internal/json";
import { installBrowserDoubles } from "../internal/test-doubles";
import {
  useAssignableUsers,
  useCreateIssue,
  useIssue,
  useIssueList,
  useIssueTemplates,
  useMentionCandidates,
  useMilestones,
  useReferenceCandidates,
  useRepoLabels,
  useSetAssignees,
  useSetIssueState,
  useSetLabels,
  useSetMilestone,
  useTimeline,
  useToggleReaction,
} from ".";
import assignableUsers from "./fixtures/assignable-users.json";
import createIssue from "./fixtures/create-issue.json";
import issueList from "./fixtures/issue-list.json";
import issueTemplates from "./fixtures/issue-templates.json";
import issue from "./fixtures/issue.json";
import labels from "./fixtures/labels.json";
import mentionCandidates from "./fixtures/mention-candidates.json";
import milestones from "./fixtures/milestones.json";
import pullList from "./fixtures/pull-list.json";
import referenceCandidates from "./fixtures/reference-candidates.json";
import subjectAssignment from "./fixtures/subject-assignment.json";
import timelinePage2 from "./fixtures/issue-timeline-page-2.json";

vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 7, login: "mona" }) }));

const OWNER = "octo-org";
const REPO = "hello-mobile";
const ISSUE_ID = "I_kwDOJx1cRc6Ab12C";
const COMMENT_ID = "IC_kwDOJx1cRc6Q1w2E";

interface SentOperation {
  operation: string;
  variables: unknown;
}
type Responder = (variables: unknown) => JsonBodyType | Promise<JsonBodyType>;

const sent: SentOperation[] = [];
let responders: Record<string, Responder> = {};
const ok: Responder = () => ({ data: {} });
const forbidden: Responder = () => ({
  errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }],
});

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
    return HttpResponse.json(await responder(variables));
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

function held(response: Responder): { responder: Responder; release: () => void } {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    responder: async (variables) => {
      await gate;
      return response(variables);
    },
    release: () => {
      release();
    },
  };
}

beforeAll(() => {
  installBrowserDoubles();
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sent.length = 0;
  responders = {
    Conversation: () => issue,
    TimelinePage: () => timelinePage2,
    RepositoryLabels: () => labels,
    AssignableUsers: () => assignableUsers,
    Milestones: () => milestones,
    SubjectAssignment: () => subjectAssignment,
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

async function loadedIssue() {
  const hook = renderHook(
    () => ({
      issue: useIssue(OWNER, REPO, 42),
      timeline: useTimeline(OWNER, REPO, 42),
      labels: useRepoLabels(OWNER, REPO),
    }),
    { wrapper },
  );
  await waitFor(() => {
    const { issue: detail, timeline, labels: repoLabels } = hook.result.current;
    expect(detail.isSuccess && timeline.isSuccess && repoLabels.isSuccess).toBe(true);
  });
  sent.length = 0;
  return hook;
}

describe("issue detail", () => {
  it("loads the header and the first timeline page with one request", async () => {
    const { result } = renderHook(
      () => ({ issue: useIssue(OWNER, REPO, 42), timeline: useTimeline(OWNER, REPO, 42) }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.issue.isSuccess && result.current.timeline.isSuccess).toBe(true);
    });
    expect(operations()).toEqual(["Conversation"]);
    expect(variablesOf("Conversation")).toEqual([
      { owner: OWNER, repo: REPO, number: 42, cursor: null },
    ]);
    expect(result.current.issue.data).toEqual({
      id: ISSUE_ID,
      repo: { owner: OWNER, name: REPO },
      number: 42,
      title: "Crash when opening notifications offline",
      state: "open",
      stateReason: "reopened",
      author: { login: "hubot", avatarUrl: "https://avatars.githubusercontent.com/u/480938?v=4" },
      bodyHtml:
        "<p>The app crashes when the notification list is opened without a network connection.</p>",
      createdAt: "2026-11-02T08:15:00Z",
      reactions: expect.arrayContaining([
        { content: "THUMBS_UP", count: 3, viewerHasReacted: true },
        { content: "HEART", count: 1, viewerHasReacted: false },
      ]) as unknown,
      labels: [
        { name: "bug", color: "d73a4a", description: "Something isn't working" },
        { name: "offline", color: "0e8a16", description: null },
      ],
      assignees: [{ login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" }],
      milestone: { id: "MI_kwDOJx1cRc4AqZ1b", title: "v1.0" },
      locked: false,
      viewerSubscribed: true,
      viewerCan: { update: true, close: true, lock: true, react: true, comment: true },
      webUrl: "https://github.com/octo-org/hello-mobile/issues/42",
    });
    const items = result.current.timeline.data?.pages[0]?.items ?? [];
    expect(items.map((entry) => entry.kind)).toEqual([
      "labeled",
      "unlabeled",
      "assigned",
      "unassigned",
      "comment",
      "crossReferenced",
      "closed",
      "reopened",
      "renamed",
    ]);
    expect(items).toContainEqual({
      kind: "crossReferenced",
      id: "CRE_kwDOJx1cRc6Ab12CzwAAAAJk1aB5",
      actor: { login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
      source: {
        repo: { owner: OWNER, name: REPO },
        number: 43,
        title: "Cache notifications for offline mode",
        isPullRequest: true,
      },
      createdAt: "2026-11-04T09:30:00Z",
    });
    expect(items).toContainEqual(
      expect.objectContaining({ kind: "closed", stateReason: "notPlanned" }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: "renamed",
        from: "Crash in notifications",
        to: "Crash when opening notifications offline",
      }),
    );
  });

  it("reuses the detail request when the timeline mounts later, then pages by cursor", async () => {
    const detail = renderHook(() => useIssue(OWNER, REPO, 42), { wrapper });
    await waitFor(() => {
      expect(detail.result.current.isSuccess).toBe(true);
    });
    const { result } = renderHook(() => useTimeline(OWNER, REPO, 42), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(operations()).toEqual(["Conversation"]);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(variablesOf("TimelinePage")).toEqual([
      { owner: OWNER, repo: REPO, number: 42, cursor: "Y3Vyc29yOnYyOpPPAAABk2F0bGluZQ==" },
    ]);
    await waitFor(() => {
      expect(result.current.data?.pages[1]?.items).toEqual([
        expect.objectContaining({ kind: "comment", id: "IC_kwDOJx1cRc6Q1w3F" }),
      ]);
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it("reports notFound for a missing issue", async () => {
    responders.Conversation = () => ({ data: { repository: { issueOrPullRequest: null } } });
    const { result } = renderHook(() => useIssue(OWNER, REPO, 404), { wrapper });
    await waitFor(() => {
      expect(result.current.error?.kind).toBe("notFound");
    });
  });
});

describe("issue lists", () => {
  it("maps open issues and requests the next page with the cursor", async () => {
    responders.IssueList = () => issueList;
    const { result } = renderHook(() => useIssueList(OWNER, REPO, "issues", "open"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(variablesOf("IssueList")[0]).toMatchObject({
      issues: true,
      issueStates: ["OPEN"],
      cursor: null,
    });
    expect(result.current.data?.pages[0]?.items[0]).toEqual({
      number: 42,
      title: "Crash when opening notifications offline",
      state: "open",
      isDraft: false,
      closedReason: null,
      author: { login: "hubot", avatarUrl: "https://avatars.githubusercontent.com/u/480938?v=4" },
      labels: [{ name: "bug", color: "d73a4a", description: "Something isn't working" }],
      comments: 2,
      updatedAt: "2026-11-06T09:00:00Z",
      checks: null,
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(variablesOf("IssueList")[1]).toMatchObject({
      cursor: "Y3Vyc29yOnYyOpK5MjAyNi0xMS0wMQ==",
    });
  });

  it("includes merged pull requests in the closed list", async () => {
    responders.IssueList = () => pullList;
    const { result } = renderHook(() => useIssueList(OWNER, REPO, "pulls", "closed"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(variablesOf("IssueList")[0]).toMatchObject({
      issues: false,
      pullStates: ["CLOSED", "MERGED"],
    });
    expect(
      result.current.data?.pages[0]?.items.map((issue) => [issue.state, issue.checks]),
    ).toEqual([
      ["merged", "success"],
      ["closed", null],
    ]);
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("labels, assignees and milestones", () => {
  it("shows the new label set at once and sends only the difference", async () => {
    const { result } = await loadedIssue();
    const addition = held(ok);
    responders.AddLabels = addition.responder;
    responders.RemoveLabels = ok;
    const mutation = renderHook(() => useSetLabels(), { wrapper });
    act(() => {
      mutation.result.current.mutate({
        subjectId: ISSUE_ID,
        owner: OWNER,
        repo: REPO,
        number: 42,
        labelNames: ["bug", "enhancement"],
      });
    });
    await waitFor(() => {
      expect(result.current.issue.data?.labels.map((label) => label.name)).toEqual([
        "bug",
        "enhancement",
      ]);
    });
    addition.release();
    await waitFor(() => {
      expect(mutation.result.current.isSuccess).toBe(true);
    });
    expect(variablesOf("AddLabels")).toEqual([
      { id: ISSUE_ID, labelIds: ["LA_kwDOJx1cRc8AAAABf1aB02"] },
    ]);
    expect(variablesOf("RemoveLabels")).toEqual([
      { id: ISSUE_ID, labelIds: ["LA_kwDOJx1cRc8AAAABf1aB03"] },
    ]);
    expect(operations()).toContain("Conversation");
  });

  it("rolls labels back when GitHub rejects the change", async () => {
    const { result } = await loadedIssue();
    responders.RemoveLabels = forbidden;
    const mutation = renderHook(() => useSetLabels(), { wrapper });
    act(() => {
      mutation.result.current.mutate({
        subjectId: ISSUE_ID,
        owner: OWNER,
        repo: REPO,
        number: 42,
        labelNames: ["bug"],
      });
    });
    await waitFor(() => {
      expect(mutation.result.current.error?.kind).toBe("forbidden");
    });
    expect(result.current.issue.data?.labels.map((label) => label.name)).toEqual([
      "bug",
      "offline",
    ]);
    expect(variablesOf("RemoveLabels")).toHaveLength(1);
  });

  it("rejects unknown label names before writing", async () => {
    await loadedIssue();
    const mutation = renderHook(() => useSetLabels(), { wrapper });
    act(() => {
      mutation.result.current.mutate({
        subjectId: ISSUE_ID,
        owner: OWNER,
        repo: REPO,
        number: 42,
        labelNames: ["bug", "offline", "wontfix"],
      });
    });
    await waitFor(() => {
      expect(mutation.result.current.error).toMatchObject({
        kind: "validation",
        fields: ["labelNames"],
      });
    });
    expect(operations()).not.toContain("AddLabels");
  });

  it("adds and removes assignees by node id", async () => {
    await loadedIssue();
    responders.AddAssignees = ok;
    responders.RemoveAssignees = ok;
    const mutation = renderHook(() => useSetAssignees(), { wrapper });
    act(() => {
      mutation.result.current.mutate({
        subjectId: ISSUE_ID,
        owner: OWNER,
        repo: REPO,
        number: 42,
        logins: ["octocat"],
      });
    });
    await waitFor(() => {
      expect(mutation.result.current.isSuccess).toBe(true);
    });
    expect(variablesOf("AddAssignees")).toEqual([
      { id: ISSUE_ID, assigneeIds: ["MDQ6VXNlcjU4MzIzMQ=="] },
    ]);
    expect(variablesOf("RemoveAssignees")).toEqual([
      { id: ISSUE_ID, assigneeIds: ["U_kgDOAAAAAQ"] },
    ]);
  });

  it("clears an issue milestone through updateIssue", async () => {
    const { result } = await loadedIssue();
    const update = held(ok);
    responders.SetIssueMilestone = update.responder;
    const mutation = renderHook(() => useSetMilestone(), { wrapper });
    act(() => {
      mutation.result.current.mutate({
        subjectId: ISSUE_ID,
        owner: OWNER,
        repo: REPO,
        number: 42,
        milestoneId: null,
      });
    });
    await waitFor(() => {
      expect(result.current.issue.data?.milestone).toBeNull();
    });
    update.release();
    await waitFor(() => {
      expect(mutation.result.current.isSuccess).toBe(true);
    });
    expect(variablesOf("SetIssueMilestone")).toEqual([{ id: ISSUE_ID, milestoneId: null }]);
  });

  it("maps label, assignee and milestone pickers without node ids", async () => {
    const { result } = renderHook(
      () => ({
        labels: useRepoLabels(OWNER, REPO),
        users: useAssignableUsers(OWNER, REPO),
        milestones: useMilestones(OWNER, REPO),
      }),
      { wrapper },
    );
    await waitFor(() => {
      const current = result.current;
      expect(current.labels.isSuccess && current.users.isSuccess).toBe(true);
      expect(current.milestones.isSuccess).toBe(true);
    });
    expect(result.current.labels.data?.[0]).toEqual({
      name: "bug",
      color: "d73a4a",
      description: "Something isn't working",
    });
    expect(result.current.users.data?.[2]).toEqual({
      login: "octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4",
    });
    expect(result.current.milestones.data).toEqual([
      { id: "MI_kwDOJx1cRc4AqZ1b", title: "v1.0", dueOn: "2026-12-01T00:00:00Z" },
      { id: "MI_kwDOJx1cRc4AqZ1c", title: "v1.1", dueOn: null },
    ]);
  });
});

describe("state and reactions", () => {
  it("closes as not planned optimistically", async () => {
    const { result } = await loadedIssue();
    const close = held(ok);
    responders.CloseIssue = close.responder;
    const mutation = renderHook(() => useSetIssueState(), { wrapper });
    act(() => {
      mutation.result.current.mutate({
        subjectId: ISSUE_ID,
        owner: OWNER,
        repo: REPO,
        number: 42,
        state: "closed",
        reason: "notPlanned",
      });
    });
    await waitFor(() => {
      expect(result.current.issue.data).toMatchObject({
        state: "closed",
        stateReason: "notPlanned",
      });
    });
    close.release();
    await waitFor(() => {
      expect(mutation.result.current.isSuccess).toBe(true);
    });
    expect(variablesOf("CloseIssue")).toEqual([{ id: ISSUE_ID, stateReason: "NOT_PLANNED" }]);
  });

  it("counts a comment reaction at once and restores it on failure", async () => {
    const { result } = await loadedIssue();
    const reaction = held(forbidden);
    responders.AddReaction = reaction.responder;
    const mutation = renderHook(() => useToggleReaction(), { wrapper });
    const thumbsUp = () =>
      result.current.timeline.data?.pages[0]?.items.flatMap((entry) =>
        entry.kind === "comment" && entry.id === COMMENT_ID
          ? entry.reactions.filter((group) => group.content === "THUMBS_UP")
          : [],
      );
    act(() => {
      mutation.result.current.mutate({ subjectId: COMMENT_ID, content: "THUMBS_UP", add: true });
    });
    await waitFor(() => {
      expect(thumbsUp()).toEqual([{ content: "THUMBS_UP", count: 2, viewerHasReacted: true }]);
    });
    reaction.release();
    await waitFor(() => {
      expect(mutation.result.current.error?.kind).toBe("forbidden");
    });
    expect(thumbsUp()).toEqual([{ content: "THUMBS_UP", count: 1, viewerHasReacted: false }]);
    expect(variablesOf("AddReaction")).toEqual([{ id: COMMENT_ID, content: "THUMBS_UP" }]);
  });
});

describe("composer candidates", () => {
  it("lists participants before other assignable users without duplicates", async () => {
    responders.MentionCandidates = () => mentionCandidates;
    const { result } = renderHook(() => useMentionCandidates(OWNER, REPO, 42), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((actor) => actor.login)).toEqual(["hubot", "mona", "octocat"]);
    expect(variablesOf("MentionCandidates")).toEqual([
      { owner: OWNER, repo: REPO, number: 42, withParticipants: true },
    ]);
  });

  it("skips participants for a new issue", async () => {
    responders.MentionCandidates = () => mentionCandidates;
    const { result } = renderHook(() => useMentionCandidates(OWNER, REPO, null), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(variablesOf("MentionCandidates")[0]).toMatchObject({ withParticipants: false });
  });

  it("merges recent issues and pull requests by update time", async () => {
    responders.ReferenceCandidates = () => referenceCandidates;
    const { result } = renderHook(() => useReferenceCandidates(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((reference) => reference.number)).toEqual([43, 42, 40, 39]);
    expect(result.current.data?.[0]).toEqual({
      number: 43,
      title: "Cache notifications for offline mode",
      isPullRequest: true,
    });
  });
});

describe("new issues", () => {
  it("parses Markdown and form templates and skips config", async () => {
    responders.IssueTemplates = () => issueTemplates;
    const { result } = renderHook(() => useIssueTemplates(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((template) => [template.kind, template.name])).toEqual([
      ["markdown", "Bug report"],
      ["unsupported", "Crash report"],
      ["form", "Feature request"],
    ]);
    expect(result.current.data?.[0]).toMatchObject({
      title: "[Bug] ",
      about: "Report something that does not work",
      labels: ["bug", "triage"],
    });
    expect(operations()).toEqual(["IssueTemplates"]);
  });

  it("returns no templates when the directory is missing", async () => {
    responders.IssueTemplates = () => ({ data: { repository: { object: null } } });
    const { result } = renderHook(() => useIssueTemplates(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual([]);
  });

  it("creates an issue with known label ids", async () => {
    responders.CreateIssue = () => createIssue;
    const { result } = renderHook(() => useCreateIssue(), { wrapper });
    let created: { number: number } | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({
        owner: OWNER,
        repo: REPO,
        title: "[Bug] Inbox is empty",
        body: "Steps",
        labels: ["Bug", "missing-label"],
      });
    });
    expect(created).toEqual({ number: 44 });
    expect(variablesOf("CreateIssue")).toEqual([
      {
        repositoryId: "R_kgDOJx1cRc",
        title: "[Bug] Inbox is empty",
        body: "Steps",
        labelIds: ["LA_kwDOJx1cRc8AAAABf1aB01"],
      },
    ]);
  });
});
