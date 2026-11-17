import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBObjectStore } from "fake-indexeddb";
import { http, HttpResponse } from "msw";
import { graphql } from "msw/graphql";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { draftKeys } from "../drafts";
import * as storage from "../internal/storage";
import { readEntry, writeEntry } from "../internal/storage";
import { installBrowserDoubles } from "../internal/test-doubles";
import lineMapping from "./fixtures/line-mapping.json";
import pullFiles from "./fixtures/pull-files.json";
import viewedFixture from "./fixtures/pull-files-viewed.json";
import threadsFixture from "./fixtures/review-threads.json";
import {
  anchorFor,
  parsePatch,
  rangeAnchor,
  suggestionBlock,
  useCommitSuggestion,
  isStalePendingReviewConflict,
  useDiscardPendingReview,
  usePendingReview,
  usePullFiles,
  useReviewThreads,
  useSetFileViewed,
  useSubmitReview,
  type DiffLine,
  type PendingComment,
  type PullFiles,
} from ".";

vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 311, login: "mona" }) }));

const API = "https://api.github.com";
const OWNER = "octo-org";
const REPO = "hello-mobile";
const HEAD_OID = viewedFixture.data.repository.pullRequest.headRefOid;
const BASE_OID = viewedFixture.data.repository.pullRequest.baseRefOid;
const PULL_ID = "PR_kwDOKx3l5c5sQq1N";
const REVIEW_ID = "PRR_kwDOKx3l5c6Ywz0A";
const github = graphql.link(`${API}/graphql`);
const server = setupServer(
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_review_fixture", expiresAt: null }),
  ),
);
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function filesUrl(number: number): string {
  return `${API}/repos/${OWNER}/${REPO}/pulls/${String(number)}/files`;
}

const greetingPatch = pullFiles.find((file) => file.filename === lineMapping.path)?.patch ?? "";
const greetingLines = parsePatch(greetingPatch).flatMap((hunk) => hunk.lines);

function diffLine(kind: DiffLine["kind"], text: string): DiffLine {
  const line = greetingLines.find((entry) => entry.kind === kind && entry.text === text);
  if (!line) throw new Error(`No ${kind} line "${text}"`);
  return line;
}

function graphQLError(message: string) {
  return { errors: [{ type: "UNPROCESSABLE", message }] };
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});

describe("usePullFiles", () => {
  it("merges REST patches with viewed state between matching revisions", async () => {
    const requests: string[] = [];
    server.use(
      http.get(filesUrl(7), ({ request }) => {
        requests.push(`rest ${new URL(request.url).search}`);
        return HttpResponse.json(pullFiles);
      }),
      github.query("PullFiles", ({ variables }) => {
        requests.push(`graphql ${JSON.stringify(variables)}`);
        return HttpResponse.json(viewedFixture);
      }),
    );
    const { result } = renderHook(() => usePullFiles(OWNER, REPO, 7), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(requests).toEqual([
      `graphql {"owner":"${OWNER}","repo":"${REPO}","number":7,"after":null}`,
      "rest ?per_page=100",
      `graphql {"owner":"${OWNER}","repo":"${REPO}","number":7,"after":null}`,
    ]);
    const changedFiles = result.current.data;
    expect(changedFiles?.headOid).toBe(HEAD_OID);
    expect(changedFiles?.baseOid).toBe(BASE_OID);
    expect(changedFiles?.totalFiles).toBe(8);
    expect(changedFiles?.truncated).toBe(false);
    const byPath = new Map(changedFiles?.files.map((file) => [file.path, file]));
    expect(byPath.get("src/greeting.ts")).toMatchObject({
      status: "modified",
      additions: 6,
      deletions: 5,
      viewed: "unviewed",
      previousPath: null,
      blobUrl: `https://github.com/${OWNER}/${REPO}/blob/${HEAD_OID}/src/greeting.ts`,
    });
    expect(byPath.get("src/greeting.ts")?.hunks).toEqual(parsePatch(greetingPatch));
    expect(byPath.get("src/i18n.ts")?.viewed).toBe("viewed");
    expect(byPath.get("src/names.ts")).toMatchObject({
      status: "renamed",
      previousPath: "src/name-format.ts",
      viewed: "dismissed",
    });
    expect(byPath.get("pnpm-lock.yaml")?.hunks).toBeNull();
    expect(byPath.get("assets/logo.png")?.hunks).toEqual([]);
    expect(byPath.get("src/legacy/format.ts")?.hunks).toEqual([]);
    expect(
      client.getQueryCache().find({ queryKey: [311, "pullFiles", OWNER, REPO, 7] })?.meta?.private,
    ).toBe(true);
  });

  it("refreshes a restored file list missing the base revision", async () => {
    const number = 53;
    client.setQueryData([311, "pullFiles", OWNER, REPO, number], {
      headOid: HEAD_OID,
      files: [],
      totalFiles: 0,
      truncated: false,
    });
    server.use(
      http.get(filesUrl(number), () => HttpResponse.json(pullFiles)),
      github.query("PullFiles", () => HttpResponse.json(viewedFixture)),
    );
    const { result } = renderHook(() => usePullFiles(OWNER, REPO, number), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.baseOid).toBe(BASE_OID);
    });
    expect(result.current.data?.files).toHaveLength(pullFiles.length);
  });

  it.each(["headRefOid", "baseRefOid"] as const)(
    "reloads patches when %s changes during collection",
    async (changedRef) => {
      let requests = 0;
      const updated = { ...viewedFixture.data.repository.pullRequest, [changedRef]: "updated" };
      server.use(
        http.get(filesUrl(37), () => {
          requests++;
          return HttpResponse.json(
            pullFiles.map((file) => ({
              ...file,
              patch: requests === 1 ? "@@ -0,0 +1 @@\n+old" : "@@ -0,0 +1 @@\n+new",
            })),
          );
        }),
        github.query("PullFiles", () =>
          HttpResponse.json({
            data: {
              repository: {
                pullRequest: requests ? updated : viewedFixture.data.repository.pullRequest,
              },
            },
          }),
        ),
      );
      const { result } = renderHook(() => usePullFiles(OWNER, REPO, 37), { wrapper });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(requests).toBe(2);
      expect(result.current.data?.headOid).toBe(updated.headRefOid);
      expect(result.current.data?.baseOid).toBe(updated.baseRefOid);
      expect(result.current.data?.files[0]?.hunks?.[0]?.lines[0]?.text).toBe("new");
    },
  );

  it("lists only the first 300 files of a larger pull request", async () => {
    const total = 350;
    const all = Array.from({ length: total }, (_, index) => ({
      ...pullFiles[0],
      filename: `src/generated/file-${String(index)}.ts`,
    }));
    let restRequests = 0;
    let graphqlRequests = 0;
    server.use(
      http.get(filesUrl(8), ({ request }) => {
        restRequests++;
        const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
        const next = `<${filesUrl(8)}?per_page=100&page=${String(page + 1)}>; rel="next"`;
        return HttpResponse.json(all.slice((page - 1) * 100, page * 100), {
          headers: page * 100 < total ? { Link: next } : {},
        });
      }),
      github.query("PullFiles", ({ variables }) => {
        graphqlRequests++;
        const offset = variables.after === null ? 0 : Number(variables.after);
        const nodes = all
          .slice(offset, offset + 100)
          .map((file) => ({ path: file.filename, viewerViewedState: "VIEWED" }));
        const pullRequest = {
          ...viewedFixture.data.repository.pullRequest,
          changedFiles: total,
          files: {
            nodes,
            pageInfo: { hasNextPage: offset + 100 < total, endCursor: String(offset + 100) },
          },
        };
        return HttpResponse.json({ data: { repository: { pullRequest } } });
      }),
    );
    const { result } = renderHook(() => usePullFiles(OWNER, REPO, 8), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.files).toHaveLength(300);
    expect(result.current.data?.files.every((file) => file.viewed === "viewed")).toBe(true);
    expect(result.current.data?.truncated).toBe(true);
    expect(result.current.data?.totalFiles).toBe(total);
    expect([restRequests, graphqlRequests]).toEqual([3, 4]);
  });
});

describe("useSetFileViewed", () => {
  function seedFiles(number: number): void {
    const files = parsePatch(greetingPatch);
    client.setQueryData<PullFiles>([311, "pullFiles", OWNER, REPO, number], {
      files: [
        {
          path: "src/greeting.ts",
          previousPath: null,
          status: "modified",
          additions: 6,
          deletions: 5,
          hunks: files,
          viewed: "unviewed",
          blobUrl: "https://github.com/octo-org/hello-mobile/blob/main/src/greeting.ts",
        },
      ],
      truncated: false,
      totalFiles: 1,
      headOid: HEAD_OID,
      baseOid: BASE_OID,
    });
  }
  const viewedOf = (number: number) =>
    client.getQueryData<PullFiles>([311, "pullFiles", OWNER, REPO, number])?.files[0]?.viewed;

  it("marks the file viewed before GitHub answers", async () => {
    seedFiles(9);
    let release = (): void => undefined;
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: unknown[] = [];
    server.use(
      github.mutation("MarkFileViewed", async ({ variables }) => {
        sent.push(variables);
        await answered;
        return HttpResponse.json({ data: { markFileAsViewed: { clientMutationId: null } } });
      }),
    );
    const { result } = renderHook(() => useSetFileViewed(), { wrapper });
    act(() => {
      result.current.mutate({
        pullRequestId: PULL_ID,
        owner: OWNER,
        repo: REPO,
        number: 9,
        path: "src/greeting.ts",
        viewed: true,
      });
    });
    await waitFor(() => {
      expect(viewedOf(9)).toBe("viewed");
    });
    release();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(sent).toEqual([{ input: { pullRequestId: PULL_ID, path: "src/greeting.ts" } }]);
    expect(viewedOf(9)).toBe("viewed");
  });

  it("rolls back when unmarking fails", async () => {
    seedFiles(10);
    client.setQueryData<PullFiles>(
      [311, "pullFiles", OWNER, REPO, 10],
      (cachedFiles) =>
        cachedFiles && {
          ...cachedFiles,
          files: cachedFiles.files.map((file) => ({ ...file, viewed: "viewed" })),
        },
    );
    server.use(
      github.mutation<Record<string, unknown>, Record<string, unknown>>("UnmarkFileViewed", () =>
        HttpResponse.json(graphQLError("Could not unmark")),
      ),
    );
    const { result } = renderHook(() => useSetFileViewed(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({
          pullRequestId: PULL_ID,
          owner: OWNER,
          repo: REPO,
          number: 10,
          path: "src/greeting.ts",
          viewed: false,
        })
        .catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.error).toMatchObject({ kind: "validation" });
    });
    expect(viewedOf(10)).toBe("viewed");
  });
});

describe("useReviewThreads", () => {
  it("maps threads, permissions and suggestions", async () => {
    server.use(github.query("ReviewThreads", () => HttpResponse.json(threadsFixture)));
    const { result } = renderHook(() => useReviewThreads(OWNER, REPO, 11), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const [single, range, outdated] = result.current.data ?? [];
    expect(single).toEqual({
      id: "PRRT_kwDOKx3l5c5Gm1Aa",
      path: "src/greeting.ts",
      line: 2,
      startLine: null,
      side: "RIGHT",
      isResolved: false,
      isOutdated: false,
      viewerCanResolve: true,
      comments: [
        {
          id: "PRRC_kwDOKx3l5c6Ab0001",
          author: {
            login: "hubot",
            avatarUrl: "https://avatars.githubusercontent.com/u/480938?v=4",
          },
          bodyHtml: '<p dir="auto">Should this import be lazy?</p>',
          createdAt: "2026-11-16T09:12:44Z",
          suggestion: null,
        },
        expect.objectContaining({ id: "PRRC_kwDOKx3l5c6Ab0002" }),
      ],
      hasMoreComments: false,
    });
    expect(range).toMatchObject({
      line: 11,
      startLine: 9,
      isResolved: true,
      viewerCanResolve: true,
      hasMoreComments: true,
    });
    expect(range?.comments[0]?.suggestion).toBe(
      [
        "export function greet(name: string, locale: string = DEFAULT_LOCALE): Greeting {",
        '  const text = translate(locale, "hello", { name: formatName(name) });',
        "  return { text, locale };",
        "",
      ].join("\n"),
    );
    expect(outdated).toMatchObject({ line: null, side: "LEFT", isOutdated: true });
    expect(outdated?.comments[0]?.author).toBeNull();
  });
});

describe("usePendingReview", () => {
  it("retries a failed load instead of caching it", async () => {
    const key = draftKeys.pendingReview(OWNER, REPO, 13);
    await writeEntry("drafts", 311, key, [
      { id: "kept", path: "README.md", line: 1, side: "RIGHT", body: "Kept" },
    ]);
    vi.spyOn(storage, "readEntry").mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    const first = renderHook(() => usePendingReview(OWNER, REPO, 13));
    await waitFor(() => {
      expect(first.result.current.error?.message).toBe("IndexedDB unavailable");
    });
    expect(first.result.current.isLoaded).toBe(false);
    first.unmount();
    const second = renderHook(() => usePendingReview(OWNER, REPO, 13));
    await waitFor(() => {
      expect(second.result.current.isLoaded).toBe(true);
    });
    expect(second.result.current.error).toBeNull();
    expect(second.result.current.comments.map((comment) => comment.id)).toEqual(["kept"]);
  });

  it("surfaces failed writes and unreadable stored comments", async () => {
    const key = draftKeys.pendingReview(OWNER, REPO, 14);
    const valid: PendingComment = { id: "ok", path: "a.ts", line: 2, side: "LEFT", body: "Fine" };
    await writeEntry("drafts", 311, key, [valid, { id: 7, line: "two" }]);
    const { result } = renderHook(() => usePendingReview(OWNER, REPO, 14));
    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });
    expect(result.current.comments).toEqual([valid]);
    expect(result.current.error?.message).toBe("Some stored review comments were unreadable");
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new Error("Quota exceeded");
    });
    act(() => {
      result.current.add({
        commitOid: HEAD_OID,
        baseOid: BASE_OID,
        path: "a.ts",
        line: 3,
        side: "RIGHT",
        body: "New",
      });
    });
    await waitFor(() => {
      expect(result.current.error?.message).toBe("Quota exceeded");
    });
    expect(result.current.comments).toHaveLength(2);
  });

  it("restores stored comments and persists changes to the drafts database", async () => {
    const key = draftKeys.pendingReview(OWNER, REPO, 12);
    const stored: PendingComment = {
      id: "c1",
      path: "README.md",
      line: 3,
      side: "RIGHT",
      body: "Nice",
    };
    await writeEntry("drafts", 311, key, [stored]);
    const { result } = renderHook(() => usePendingReview(OWNER, REPO, 12));
    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });
    expect(result.current.comments).toEqual([stored]);
    await act(async () => {
      result.current.add({
        commitOid: HEAD_OID,
        baseOid: BASE_OID,
        path: "README.md",
        line: 5,
        side: "LEFT",
        body: "Removed?",
      });
      await result.current.update(stored.id, "Very nice", stored.body);
    });
    await waitFor(() => {
      expect(result.current.comments).toHaveLength(2);
    });
    await waitFor(async () => {
      expect(await readEntry("drafts", 311, key)).toEqual(result.current.comments);
    });
    expect(result.current.comments[0]?.body).toBe("Very nice");
    act(() => {
      for (const comment of result.current.comments) result.current.remove(comment.id);
    });
    await waitFor(async () => {
      expect(await readEntry("drafts", 311, key)).toBeUndefined();
    });
  });
});

interface ReviewServerState {
  pendingReview: string | null;
  pendingCommit: string | null;
  lookups: number;
  deleted: unknown[];
  started: unknown[];
  threads: Record<string, unknown>[];
  submitted: unknown[];
  headOid: string;
  baseOid: string;
  archivedCount: number;
  failSubmit: boolean;
  summary: string;
  loseThreadResponse: boolean;
  failThreadCall: number | null;
}

function reviewState(overrides: Partial<ReviewServerState> = {}): ReviewServerState {
  return {
    pendingReview: null,
    pendingCommit: null,
    lookups: 0,
    deleted: [],
    started: [],
    threads: [],
    submitted: [],
    headOid: HEAD_OID,
    baseOid: BASE_OID,
    archivedCount: 0,
    failSubmit: false,
    summary: "",
    loseThreadResponse: false,
    failThreadCall: null,
    ...overrides,
  };
}

function reviewServer(state: ReviewServerState, discardNumber?: number): void {
  server.use(
    github.query("PendingReview", ({ variables }) => {
      state.lookups++;
      expect(variables).toEqual({ pullRequestId: PULL_ID, author: "mona" });
      const nodes =
        state.pendingReview === null
          ? []
          : [
              {
                id: state.pendingReview,
                commit: { oid: state.pendingCommit },
                databaseId: 123,
                comments: { totalCount: state.threads.length },
              },
            ];
      return HttpResponse.json({
        data: {
          node: { headRefOid: state.headOid, baseRefOid: state.baseOid, reviews: { nodes } },
        },
      });
    }),
    github.mutation<Record<string, unknown>, { input: { commitOID: string } }>(
      "StartReview",
      ({ variables }) => {
        state.started.push(variables);
        const id = state.started.length === 1 ? REVIEW_ID : "PRR_followup";
        state.pendingReview = id;
        state.pendingCommit = variables.input.commitOID;
        return HttpResponse.json({
          data: { addPullRequestReview: { pullRequestReview: { id } } },
        });
      },
    ),
    github.mutation<Record<string, unknown>, { input: Record<string, unknown> }>(
      "AddReviewThread",
      ({ variables }) => {
        if (state.threads.length + 1 === state.failThreadCall) {
          state.failThreadCall = null;
          return HttpResponse.json(
            graphQLError("pull_request_review_thread.line must be part of the diff"),
          );
        }
        state.threads.push(variables.input);
        if (state.loseThreadResponse) {
          state.loseThreadResponse = false;
          return HttpResponse.error();
        }
        const id = `PRRT_${String(state.threads.length)}`;
        return HttpResponse.json({ data: { addPullRequestReviewThread: { thread: { id } } } });
      },
    ),
    http.get(`${API}/repos/${OWNER}/${REPO}/pulls/:number/reviews/123/comments`, () =>
      HttpResponse.json(
        state.threads.map((thread, index) => ({
          node_id: `RC${String(index)}`,
          path: thread.path,
          body: thread.body,
          original_line: thread.line,
          side: thread.side,
          original_start_line: thread.startLine,
          start_side: thread.startSide,
        })),
      ),
    ),
    github.query("PullPendingReview", ({ variables }) => {
      expect(variables).toEqual({
        owner: OWNER,
        repo: REPO,
        number: discardNumber,
        author: "mona",
      });
      const nodes =
        state.pendingReview === null
          ? []
          : [
              {
                id: state.pendingReview,
                databaseId: 123,
                body: state.summary,
                commit: { oid: state.pendingCommit },
                comments: { totalCount: state.archivedCount },
              },
            ];
      return HttpResponse.json({
        data: {
          repository: {
            pullRequest: {
              headRefOid: state.headOid,
              baseRefOid: state.baseOid,
              reviews: { nodes },
            },
          },
        },
      });
    }),
    github.mutation("DeletePendingReview", ({ variables }) => {
      state.deleted.push(variables);
      const id = state.pendingReview;
      state.pendingReview = null;
      return HttpResponse.json({
        data: { deletePullRequestReview: { pullRequestReview: { id } } },
      });
    }),
    github.mutation<Record<string, unknown>, Record<string, unknown>>(
      "SubmitReview",
      ({ variables }) => {
        if (state.failSubmit) {
          state.failSubmit = false;
          return HttpResponse.json(graphQLError("Summary refused"));
        }
        state.submitted.push(variables);
        const id = state.pendingReview;
        state.pendingReview = null;
        return HttpResponse.json({
          data: { submitPullRequestReview: { pullRequestReview: { id } } },
        });
      },
    ),
  );
}

function renderReview(number: number, owner = OWNER, repo = REPO) {
  return renderHook(
    () => ({ pending: usePendingReview(owner, repo, number), submit: useSubmitReview() }),
    { wrapper },
  );
}

describe("useSubmitReview", () => {
  const importLine = diffLine("add", 'import { translate } from "./i18n";');
  const greetStart = diffLine(
    "add",
    "export function greet(name: string, locale = DEFAULT_LOCALE): Greeting {",
  );
  const greetEnd = diffLine("add", "  return { text, locale };");
  const oldLocale = diffLine("del", 'export const DEFAULT_LOCALE = "en";');
  const newLocale = diffLine("add", 'export const DEFAULT_LOCALE = "ja";');
  const path = lineMapping.path;
  const drafts: (Omit<PendingComment, "id"> & { commitOid: string; baseOid: string })[] = [
    {
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
      path,
      ...anchorFor(importLine),
      body: "Why a new import?",
    },
    {
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
      path,
      ...rangeAnchor(greetStart, greetEnd),
      body: "Document the locale fallback.",
    },
    {
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
      path,
      ...rangeAnchor(oldLocale, newLocale),
      body: "Changing the default is breaking.",
    },
    {
      path,
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
      ...anchorFor(newLocale),
      body: suggestionBlock(['export const DEFAULT_LOCALE = "en";']),
    },
  ];

  it("lands single-line, multi-line, cross-side and suggestion comments on their lines", async () => {
    const state = reviewState();
    reviewServer(state);
    const { result } = renderReview(21);
    await waitFor(() => {
      expect(result.current.pending.isLoaded).toBe(true);
    });
    act(() => {
      for (const draft of drafts) result.current.pending.add(draft);
    });
    await waitFor(() => {
      expect(result.current.pending.comments).toHaveLength(drafts.length);
    });
    await act(() =>
      result.current.submit.mutateAsync({
        pullRequestId: PULL_ID,
        owner: OWNER,
        repo: REPO,
        number: 21,
        event: "REQUEST_CHANGES",
        body: "Please keep English as the default.",
        commitOid: HEAD_OID,
        baseOid: BASE_OID,
        comments: result.current.pending.comments,
      }),
    );
    expect(state.started).toEqual([{ input: { pullRequestId: PULL_ID, commitOID: HEAD_OID } }]);
    expect(state.threads).toEqual([
      {
        pullRequestReviewId: REVIEW_ID,
        path: "src/greeting.ts",
        body: "Why a new import?",
        line: 2,
        side: "RIGHT",
      },
      {
        pullRequestReviewId: REVIEW_ID,
        path: "src/greeting.ts",
        body: "Document the locale fallback.",
        line: 11,
        side: "RIGHT",
        startLine: 9,
        startSide: "RIGHT",
      },
      {
        pullRequestReviewId: REVIEW_ID,
        path: "src/greeting.ts",
        body: "Changing the default is breaking.",
        line: 30,
        side: "RIGHT",
        startLine: 29,
        startSide: "LEFT",
      },
      {
        pullRequestReviewId: REVIEW_ID,
        path: "src/greeting.ts",
        body: '```suggestion\nexport const DEFAULT_LOCALE = "en";\n```',
        line: 30,
        side: "RIGHT",
      },
    ]);
    expect(state.submitted).toEqual([
      {
        input: {
          pullRequestReviewId: REVIEW_ID,
          event: "REQUEST_CHANGES",
          body: "Please keep English as the default.",
        },
      },
    ]);
    expect(result.current.pending.comments).toEqual([]);
    expect(
      await readEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, 21)),
    ).toBeUndefined();
  });

  it("resumes the pending review after a partial failure without duplicates", async () => {
    const state = reviewState({ failThreadCall: 2 });
    reviewServer(state);
    const { result } = renderReview(22);
    await waitFor(() => {
      expect(result.current.pending.isLoaded).toBe(true);
    });
    act(() => {
      for (const draft of drafts.slice(0, 3)) result.current.pending.add(draft);
    });
    await waitFor(() => {
      expect(result.current.pending.comments).toHaveLength(3);
    });
    const submission = {
      pullRequestId: PULL_ID,
      owner: OWNER,
      repo: REPO,
      number: 22,
      event: "COMMENT" as const,
      body: "",
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
    };
    await act(async () => {
      await result.current.submit
        .mutateAsync({ ...submission, comments: result.current.pending.comments })
        .catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.submit.error).toMatchObject({ kind: "validation" });
    });
    expect(state.threads.map((thread) => thread.body)).toEqual(["Why a new import?"]);
    expect(state.submitted).toEqual([]);
    const remaining = result.current.pending.comments.map((comment) => comment.body);
    expect(remaining).toEqual([
      "Why a new import?",
      "Document the locale fallback.",
      "Changing the default is breaking.",
    ]);
    expect(await readEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, 22))).toEqual(
      result.current.pending.comments,
    );

    await act(() =>
      result.current.submit.mutateAsync({
        ...submission,
        comments: result.current.pending.comments,
      }),
    );
    expect(state.started).toHaveLength(1);
    expect(state.threads.map((thread) => thread.body)).toEqual([
      "Why a new import?",
      "Document the locale fallback.",
      "Changing the default is breaking.",
    ]);
    expect(state.threads.every((thread) => thread.pullRequestReviewId === REVIEW_ID)).toBe(true);
    expect(state.submitted).toEqual([
      { input: { pullRequestReviewId: REVIEW_ID, event: "COMMENT", body: "" } },
    ]);
    expect(result.current.pending.comments).toEqual([]);
  });
  async function addDrafts(
    result: { current: ReturnType<typeof renderReview>["result"]["current"] },
    entries: readonly (Omit<PendingComment, "id"> & { commitOid: string; baseOid: string })[],
  ): Promise<void> {
    await waitFor(() => {
      expect(result.current.pending.isLoaded).toBe(true);
    });
    act(() => {
      for (const draft of entries) result.current.pending.add(draft);
    });
    await waitFor(() => {
      expect(result.current.pending.comments).toHaveLength(entries.length);
    });
  }

  function submission(number: number, comments: readonly PendingComment[]) {
    return {
      pullRequestId: PULL_ID,
      owner: OWNER,
      repo: REPO,
      number,
      event: "COMMENT" as const,
      body: "Looks good.",
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
      comments,
    };
  }

  it("retries an empty-summary review without recreating landed threads", async () => {
    const state = reviewState({ failSubmit: true });
    reviewServer(state);
    const { result } = renderReview(31);
    await addDrafts(result, drafts.slice(0, 2));
    const send = () =>
      result.current.submit.mutateAsync({
        ...submission(31, result.current.pending.comments),
        body: "",
      });
    await act(async () => {
      await expect(send()).rejects.toMatchObject({ kind: "validation" });
    });
    expect(await readEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, 31))).toMatchObject([
      { body: "Why a new import?", pendingReviewId: REVIEW_ID },
      { body: "Document the locale fallback.", pendingReviewId: REVIEW_ID },
    ]);
    await act(send);
    expect(state.threads).toHaveLength(2);
    expect(state.started).toHaveLength(1);
    expect(state.submitted).toHaveLength(1);
    expect(result.current.pending.comments).toEqual([]);
  });

  it("recovers an unacknowledged thread without duplicating identical drafts", async () => {
    const state = reviewState({ loseThreadResponse: true });
    reviewServer(state);
    const { result } = renderReview(38);
    const identical = {
      path: "a.ts",
      line: 1,
      side: "RIGHT" as const,
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
      body: "Same text",
    };
    await addDrafts(result, [identical, identical]);
    const send = () =>
      result.current.submit.mutateAsync(submission(38, result.current.pending.comments));
    await act(async () => {
      await expect(send()).rejects.toMatchObject({ kind: "network" });
    });
    expect(state.threads).toHaveLength(1);
    expect(await readEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, 38))).toMatchObject([
      { body: "Same text", pendingReviewId: REVIEW_ID, previousMatches: 0 },
      { body: "Same text" },
    ]);
    await act(send);
    expect(state.threads.map((thread) => thread.body)).toEqual(["Same text", "Same text"]);
    expect(state.submitted).toHaveLength(1);
    expect(result.current.pending.comments).toEqual([]);
  });

  it("keeps an unconfirmed draft when a published review did not contain it", async () => {
    const key = draftKeys.pendingReview(OWNER, REPO, 40);
    await writeEntry("drafts", 311, key, [
      {
        id: "unsent",
        path: "a.ts",
        line: 1,
        side: "RIGHT",
        body: "Only on this device",
        commitOid: HEAD_OID,
        baseOid: BASE_OID,
        pendingReviewId: "published-elsewhere",
        previousMatches: 0,
      },
    ]);
    const state = reviewState();
    reviewServer(state);
    server.use(
      github.query("ReviewState", () =>
        HttpResponse.json({
          data: { node: { state: "COMMENTED", databaseId: 123, comments: { totalCount: 0 } } },
        }),
      ),
    );
    const { result } = renderReview(40);
    await waitFor(() => {
      expect(result.current.pending.comments).toHaveLength(1);
    });
    await act(() =>
      result.current.submit.mutateAsync(submission(40, result.current.pending.comments)),
    );
    expect(state.threads.map((thread) => thread.body)).toEqual(["Only on this device"]);
    expect(state.submitted).toHaveLength(1);
  });

  it("keeps a rejected approval eligible after another client submits a comment", async () => {
    const state = reviewState({ failSubmit: true });
    reviewServer(state);
    const review = { ...submission(53, []), event: "APPROVE" as const };
    const { result } = renderReview(53);
    await act(async () => {
      await expect(result.current.submit.mutateAsync(review)).rejects.toMatchObject({
        kind: "validation",
      });
    });
    state.pendingReview = null;
    server.use(
      github.query("ReviewState", () =>
        HttpResponse.json({
          data: { node: { state: "COMMENTED", body: review.body, commit: { oid: HEAD_OID } } },
        }),
      ),
    );
    await act(() => result.current.submit.mutateAsync(review));
    expect(state.started).toHaveLength(2);
    expect(state.submitted).toEqual([
      { input: { pullRequestReviewId: "PRR_followup", body: review.body, event: "APPROVE" } },
    ]);
  });

  it.each(["APPROVED", "CHANGES_REQUESTED"])(
    "recovers a dismissed legacy review using its original %s event",
    async (originalState) => {
      const number = 51;
      const review = { ...submission(number, []), event: "APPROVE" as const };
      const draft = { ...drafts[0], id: "legacy", pendingReviewId: REVIEW_ID };
      await writeEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, number), [draft]);
      const state = reviewState();
      reviewServer(state);
      server.use(
        github.query("ReviewState", () =>
          HttpResponse.json({
            data: { node: { state: "DISMISSED", body: review.body, commit: { oid: HEAD_OID } } },
          }),
        ),
        github.query("ReviewDismissals", () =>
          HttpResponse.json({
            data: {
              node: {
                timelineItems: {
                  nodes: [{ review: { id: REVIEW_ID }, previousReviewState: originalState }],
                  pageInfo: { hasPreviousPage: false, startCursor: null },
                },
              },
            },
          }),
        ),
      );
      const { result } = renderReview(number);
      await waitFor(() => {
        expect(result.current.pending.comments).toHaveLength(1);
      });
      await act(() =>
        result.current.submit.mutateAsync({ ...review, comments: result.current.pending.comments }),
      );
      const expected = originalState === "APPROVED" ? 0 : 1;
      expect(state.started).toHaveLength(expected);
      expect(state.submitted).toHaveLength(expected);
      expect(result.current.pending.comments).toEqual([]);
    },
  );

  it.each([
    { retryHead: HEAD_OID, remoteState: "APPROVED" },
    { retryHead: "updated-head", remoteState: "APPROVED" },
    { retryHead: HEAD_OID, remoteState: "DISMISSED" },
    { retryHead: HEAD_OID, remoteState: "CHANGES_REQUESTED" },
    { retryHead: HEAD_OID, remoteState: "COMMENTED" },
    { retryHead: HEAD_OID, remoteState: "SUBMITTED" },
  ])(
    "recovers a $remoteState summary-only approval after a lost response with head $retryHead",
    async ({ retryHead, remoteState }) => {
      const state = reviewState();
      reviewServer(state);
      const review = { ...submission(41, []), event: "APPROVE" as const };
      server.use(
        github.mutation(
          "SubmitReview",
          ({ variables }) => {
            state.submitted.push(variables);
            state.pendingReview = null;
            return HttpResponse.error();
          },
          { once: true },
        ),
        github.query("ReviewState", ({ variables }) => {
          expect(variables).toEqual({ id: REVIEW_ID });
          return HttpResponse.json({
            data: { node: { state: remoteState, body: review.body, commit: { oid: HEAD_OID } } },
          });
        }),
      );
      const first = renderHook(() => useSubmitReview(), { wrapper });
      await act(async () => {
        await expect(first.result.current.mutateAsync(review)).rejects.toMatchObject({
          kind: "network",
        });
      });
      first.unmount();
      const retry = renderHook(() => useSubmitReview(), { wrapper });
      state.headOid = retryHead;
      await act(() => retry.result.current.mutateAsync({ ...review, commitOid: retryHead }));
      expect(state.started).toHaveLength(retryHead === HEAD_OID ? 1 : 2);
      expect(state.submitted).toHaveLength(retryHead === HEAD_OID ? 1 : 2);
    },
  );

  it.each([
    { changed: "nothing", event: "COMMENT", body: "Looks good.", head: HEAD_OID, expected: 1 },
    { changed: "summary", event: "COMMENT", body: "Updated summary", head: HEAD_OID, expected: 2 },
    {
      changed: "event",
      event: "REQUEST_CHANGES",
      body: "Looks good.",
      head: HEAD_OID,
      expected: 2,
    },
    { changed: "commit", event: "COMMENT", body: "Looks good.", head: "new-head", expected: 2 },
  ] as const)(
    "recovers a published thread once when $changed changed",
    async ({ event, body, head, expected }) => {
      const state = reviewState();
      reviewServer(state);
      const { result } = renderReview(37);
      await addDrafts(result, drafts.slice(0, 1));
      server.use(
        github.mutation(
          "SubmitReview",
          ({ variables }) => {
            state.submitted.push(variables);
            state.pendingReview = null;
            return HttpResponse.error();
          },
          { once: true },
        ),
        github.query("ReviewState", ({ variables }) => {
          expect(variables).toEqual({ id: REVIEW_ID });
          return HttpResponse.json({
            data: { node: { state: "COMMENTED", body: "Looks good.", commit: { oid: HEAD_OID } } },
          });
        }),
      );
      await act(async () => {
        await expect(
          result.current.submit.mutateAsync(submission(37, result.current.pending.comments)),
        ).rejects.toMatchObject({ kind: "network" });
      });
      state.headOid = head;
      await act(() =>
        result.current.submit.mutateAsync({
          ...submission(37, result.current.pending.comments),
          event,
          body,
          commitOid: head,
        }),
      );
      expect(state.started).toHaveLength(expected);
      expect(state.threads).toHaveLength(1);
      expect(state.submitted).toHaveLength(expected);
      expect(state.submitted.at(-1)).toMatchObject({
        input: { body, event, pullRequestReviewId: expected === 1 ? REVIEW_ID : "PRR_followup" },
      });
      expect(result.current.pending.comments).toEqual([]);
    },
  );

  it.each(["old", undefined])(
    "blocks old and legacy anchors before creating a review (%s)",
    async (commitOid) => {
      const number = commitOid ? 32 : 33;
      const draft = {
        id: "older",
        path: "README.md",
        body: "Original text",
        line: 4,
        side: "RIGHT",
        ...(commitOid ? { commitOid } : {}),
      };
      await writeEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, number), [draft]);
      const state = reviewState();
      reviewServer(state);
      const { result } = renderReview(number);
      await waitFor(() => {
        expect(result.current.pending.comments).toHaveLength(1);
      });
      await act(async () => {
        await expect(
          result.current.submit.mutateAsync(submission(number, result.current.pending.comments)),
        ).rejects.toMatchObject({ headOid: HEAD_OID });
      });
      expect(state.started).toEqual([]);
      expect(state.threads).toEqual([]);
      expect(result.current.pending.comments).toEqual([draft]);
    },
  );

  it.each(["old-base", undefined])(
    "keeps deleted-line drafts when their base is stale or unknown (%s)",
    async (baseOid) => {
      const draft = {
        id: "old-line",
        commitOid: HEAD_OID,
        ...(baseOid ? { baseOid } : {}),
        path,
        line: 2,
        side: "LEFT",
        body: "Deleted line",
      };
      await writeEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, 48), [draft]);
      const state = reviewState();
      reviewServer(state);
      const { result } = renderReview(48);
      await waitFor(() => {
        expect(result.current.pending.comments).toHaveLength(1);
      });
      await act(async () => {
        await expect(
          result.current.submit.mutateAsync(submission(48, result.current.pending.comments)),
        ).rejects.toMatchObject({ headOid: HEAD_OID, baseOid: BASE_OID });
      });
      expect(state.started).toEqual([]);
      expect(state.threads).toEqual([]);
      expect(result.current.pending.comments).toEqual([draft]);
    },
  );

  it("checks the live head even when the displayed patch is cached", async () => {
    const state = reviewState({ headOid: "new-head" });
    reviewServer(state);
    const { result } = renderReview(34);
    await addDrafts(result, drafts.slice(0, 1));
    await act(async () => {
      await expect(
        result.current.submit.mutateAsync(submission(34, result.current.pending.comments)),
      ).rejects.toMatchObject({ headOid: "new-head" });
    });
    expect(state.started).toEqual([]);
    expect(state.threads).toEqual([]);
    expect(state.submitted).toEqual([]);
  });

  it("refreshes the conversation for mixed-case routes", async () => {
    const state = reviewState();
    reviewServer(state);
    const conversation = [311, "conversation", "octo-org", "hello-mobile", 23];
    const files = [311, "pullFiles", "octo-org", "hello-mobile", 23];
    client.setQueryData(conversation, { title: "Translate the greeting" });
    client.setQueryData(files, { files: [] });
    const { result } = renderReview(23, "Octo-Org", "Hello-Mobile");
    await waitFor(() => {
      expect(result.current.pending.isLoaded).toBe(true);
    });
    await act(() =>
      result.current.submit.mutateAsync({
        ...submission(23, []),
        owner: "Octo-Org",
        repo: "Hello-Mobile",
        event: "APPROVE",
        body: "",
      }),
    );
    expect(state.submitted).toHaveLength(1);
    expect(client.getQueryState(conversation)?.isInvalidated).toBe(true);
    expect(client.getQueryState(files)?.isInvalidated).toBe(true);
  });

  it("refuses a pending review on another commit", async () => {
    const state = reviewState({
      pendingReview: REVIEW_ID,
      pendingCommit: "0123456789abcdef0123456789abcdef01234567",
    });
    reviewServer(state);
    const { result } = renderReview(24);
    await addDrafts(result, drafts.slice(0, 1));
    await act(async () => {
      await result.current.submit
        .mutateAsync(submission(24, result.current.pending.comments))
        .catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.submit.error).toMatchObject({ kind: "conflict" });
    });
    expect([state.threads, state.submitted]).toEqual([[], []]);
    expect(result.current.pending.comments).toHaveLength(1);
    expect(isStalePendingReviewConflict(result.current.submit.error)).toBe(true);
    expect(isStalePendingReviewConflict({ kind: "conflict", message: "Head moved" })).toBe(false);
  });

  it("discards the older pending review and resubmits the kept drafts", async () => {
    const state = reviewState({
      pendingReview: REVIEW_ID,
      pendingCommit: "0123456789abcdef0123456789abcdef01234567",
    });
    reviewServer(state, 28);
    const conversation = [311, "conversation", "octo-org", "hello-mobile", 28];
    client.setQueryData(conversation, { title: "Translate the greeting" });
    const { result } = renderHook(
      () => ({
        pending: usePendingReview(OWNER, REPO, 28),
        submit: useSubmitReview(),
        discard: useDiscardPendingReview(),
      }),
      { wrapper },
    );
    await addDrafts(result, drafts.slice(0, 1));
    await act(() =>
      result.current.discard.mutateAsync({
        owner: OWNER,
        repo: REPO,
        number: 28,
        reviewId: REVIEW_ID,
      }),
    );
    expect(state.deleted).toEqual([{ input: { pullRequestReviewId: REVIEW_ID } }]);
    expect(client.getQueryState(conversation)?.isInvalidated).toBe(true);
    expect(result.current.pending.comments).toHaveLength(1);
    await act(() =>
      result.current.submit.mutateAsync(submission(28, result.current.pending.comments)),
    );
    expect(state.started).toEqual([{ input: { pullRequestId: PULL_ID, commitOID: HEAD_OID } }]);
    expect(state.threads.map((thread) => thread.body)).toEqual(["Why a new import?"]);
    expect(state.submitted).toHaveLength(1);
    await act(() =>
      result.current.discard.mutateAsync({
        owner: OWNER,
        repo: REPO,
        number: 28,
        reviewId: REVIEW_ID,
      }),
    );
    expect(state.deleted).toHaveLength(1);
  });

  it("backs up a pending review when only the base has changed", async () => {
    const number = 49;
    const state = reviewState({
      pendingReview: REVIEW_ID,
      pendingCommit: HEAD_OID,
      baseOid: "changed-base",
    });
    reviewServer(state, number);
    const local = {
      id: "on-github",
      commitOid: HEAD_OID,
      baseOid: BASE_OID,
      path,
      line: 2,
      side: "LEFT",
      body: "Original deletion",
    };
    const unsent = { ...local, id: "unsent", body: "Other deletion" };
    const key = draftKeys.pendingReview(OWNER, REPO, number);
    await writeEntry("drafts", 311, key, [{ ...local, pendingReviewId: REVIEW_ID }, unsent]);
    const { result } = renderReview(number);
    await waitFor(() => {
      expect(result.current.pending.comments).toHaveLength(2);
    });
    await act(async () => {
      await expect(
        result.current.submit.mutateAsync(submission(number, result.current.pending.comments)),
      ).rejects.toMatchObject({ reviewId: REVIEW_ID });
    });
    const discard = renderHook(() => useDiscardPendingReview(), { wrapper });
    await act(() =>
      discard.result.current.mutateAsync({ owner: OWNER, repo: REPO, number, reviewId: REVIEW_ID }),
    );
    expect(state.deleted).toHaveLength(1);
    expect(await readEntry("drafts", 311, key)).toEqual([local, unsent]);
  });

  it("saves server-only text before discarding a stale review", async () => {
    const state = reviewState({
      pendingReview: REVIEW_ID,
      pendingCommit: "older",
      archivedCount: 2,
    });
    reviewServer(state, 35);
    const existing = {
      id: "local-id",
      path: "a.ts",
      line: 1,
      side: "RIGHT",
      body: "Already on both",
      commitOid: "older",
      pendingReviewId: REVIEW_ID,
    };
    const key = draftKeys.pendingReview(OWNER, REPO, 35);
    await writeEntry("drafts", 311, key, [existing]);
    server.use(
      http.get(filesUrl(35).replace(/files$/, "reviews/123/comments"), () =>
        HttpResponse.json([
          {
            node_id: "server-one",
            path: "a.ts",
            body: "Already on both",
            original_line: 1,
            side: "RIGHT",
          },
          {
            id: 102,
            node_id: "server-two",
            path: "b.ts",
            body: "Only on GitHub",
            original_position: 3,
          },
        ]),
      ),
      http.get(`${API}/repos/${OWNER}/${REPO}/pulls/comments/102`, () =>
        HttpResponse.json({
          id: 102,
          node_id: "server-two",
          path: "b.ts",
          body: "Only on GitHub",
          original_line: 7,
          side: "LEFT",
        }),
      ),
    );
    const { result } = renderHook(() => useDiscardPendingReview(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ owner: OWNER, repo: REPO, number: 35, reviewId: REVIEW_ID }),
    );
    expect(state.deleted).toHaveLength(1);
    expect(await readEntry("drafts", 311, key)).toEqual([
      {
        id: "local-id",
        path: "a.ts",
        line: 1,
        side: "RIGHT",
        body: "Already on both",
        commitOid: "older",
      },
      { id: "server-two", path: "b.ts", line: 7, side: "LEFT", body: "Only on GitHub" },
    ]);
  });

  it("preserves a server-only summary when discarding would lose it", async () => {
    const state = reviewState({
      pendingReview: REVIEW_ID,
      pendingCommit: "older",
      summary: "Only on GitHub",
    });
    reviewServer(state, 39);
    const { result } = renderHook(() => useDiscardPendingReview(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ owner: OWNER, repo: REPO, number: 39, reviewId: REVIEW_ID }),
      ).rejects.toMatchObject({ kind: "conflict" });
    });
    expect(state.deleted).toEqual([]);
  });

  it("keeps the server review when its comments cannot be backed up", async () => {
    const state = reviewState({
      pendingReview: REVIEW_ID,
      pendingCommit: "older",
      archivedCount: 2,
    });
    reviewServer(state, 36);
    server.use(
      http.get(filesUrl(36).replace(/files$/, "reviews/123/comments"), () => HttpResponse.json([])),
    );
    const { result } = renderHook(() => useDiscardPendingReview(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ owner: OWNER, repo: REPO, number: 36, reviewId: REVIEW_ID }),
      ).rejects.toMatchObject({ kind: "conflict" });
    });
    expect(state.deleted).toEqual([]);
  });

  it("rejects a range that ends left of an added start before any request", async () => {
    const state = reviewState();
    reviewServer(state);
    const { result } = renderReview(25);
    const backward: PendingComment = {
      id: "backward",
      path,
      line: 29,
      side: "LEFT",
      startLine: 27,
      startSide: "RIGHT",
      body: "Invalid range",
    };
    await act(async () => {
      await result.current.submit.mutateAsync(submission(25, [backward])).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.submit.error).toMatchObject({
        kind: "validation",
        fields: ["startSide"],
      });
    });
    expect(state.lookups).toBe(0);
  });

  it("sends a snapshot once when submit is tapped twice", async () => {
    const state = reviewState();
    reviewServer(state);
    const { result } = renderReview(26);
    await addDrafts(result, drafts.slice(0, 2));
    const snapshot = submission(26, result.current.pending.comments);
    const outcomes = await act(() =>
      Promise.all([
        result.current.submit.mutateAsync(snapshot),
        result.current.submit.mutateAsync(snapshot),
      ]),
    );
    expect(outcomes).toEqual([undefined, "draftsChanged"]);
    expect(state.threads.map((thread) => thread.body)).toEqual([
      "Why a new import?",
      "Document the locale fallback.",
    ]);
    expect([state.started.length, state.submitted.length]).toEqual([1, 1]);
  });

  it("waits for another tab's submission before discarding the same review", async () => {
    const number = 50;
    const state = reviewState();
    reviewServer(state, number);
    let release = (): void => undefined;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sending = false;
    server.use(
      github.mutation("SubmitReview", async () => {
        sending = true;
        await response;
        state.pendingReview = null;
        return HttpResponse.json({
          data: { submitPullRequestReview: { pullRequestReview: { id: REVIEW_ID } } },
        });
      }),
    );
    const { result } = renderReview(number);
    await addDrafts(result, drafts.slice(0, 1));
    const peer = new QueryClient();
    const discard = renderHook(() => useDiscardPendingReview(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={peer}>{children}</QueryClientProvider>
      ),
    });
    const lock = vi.spyOn(navigator.locks, "request");
    const submit = result.current.submit.mutateAsync(
      submission(number, result.current.pending.comments),
    );
    await waitFor(() => {
      expect(sending).toBe(true);
    });
    const requestsBeforeDiscard = lock.mock.calls.length;
    const disposal = discard.result.current.mutateAsync({
      owner: OWNER,
      repo: REPO,
      number,
      reviewId: REVIEW_ID,
    });
    try {
      await waitFor(() => {
        expect(lock.mock.calls.length).toBeGreaterThan(requestsBeforeDiscard);
      });
    } finally {
      release();
      await act(() => Promise.all([submit, disposal]));
      peer.clear();
    }
    expect(state.deleted).toEqual([]);
    expect(state.threads).toHaveLength(1);
  });

  it("stops when a landed thread receipt cannot be persisted", async () => {
    const state = reviewState();
    reviewServer(state);
    const { result } = renderReview(27);
    await addDrafts(result, drafts.slice(0, 2));
    await waitFor(async () => {
      expect(await readEntry("drafts", 311, draftKeys.pendingReview(OWNER, REPO, 27))).toHaveLength(
        2,
      );
    });
    const quota = new DOMException("Quota exceeded", "QuotaExceededError");
    server.use(
      github.mutation<Record<string, unknown>, { input: Record<string, unknown> }>(
        "AddReviewThread",
        ({ variables }) => {
          state.threads.push(variables.input);
          vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
            throw quota;
          });
          return HttpResponse.json({
            data: { addPullRequestReviewThread: { thread: { id: "landed" } } },
          });
        },
      ),
    );
    await act(async () => {
      await result.current.submit
        .mutateAsync(submission(27, result.current.pending.comments))
        .catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.submit.error).toBe(quota);
    });
    expect(state.threads.map((thread) => thread.body)).toEqual(["Why a new import?"]);
    expect(state.submitted).toEqual([]);
    expect(result.current.pending.error?.message).toContain("Quota exceeded");
    expect(result.current.pending.comments.map((comment) => comment.body)).toEqual([
      "Why a new import?",
      "Document the locale fallback.",
    ]);
  });
});

describe("useCommitSuggestion", () => {
  const replacement = [
    "export function greet(name: string, locale: string = DEFAULT_LOCALE): Greeting {",
    '  const text = translate(locale, "hello", { name: formatName(name) });',
    "  return { text, locale };",
    "",
  ].join("\n");
  const suggestion = {
    owner: OWNER,
    repo: REPO,
    branch: "feature/i18n",
    path: lineMapping.path,
    expectedHeadOid: HEAD_OID,
    startLine: 9,
    endLine: 11,
    replacement,
    headline: "Apply suggestion from code review",
  };

  function decodeBase64(contents: string): string {
    return new TextDecoder().decode(Uint8Array.from(atob(contents), (char) => char.charCodeAt(0)));
  }

  function blobServer(blob: { text: string | null; isBinary: boolean; isTruncated: boolean }) {
    type CommitInput = { fileChanges: { additions: { path: string; contents: string }[] } };
    const commits: CommitInput[] = [];
    const reads: unknown[] = [];
    server.use(
      github.query("SuggestionFile", ({ variables }) => {
        reads.push(variables);
        return HttpResponse.json({
          data: { repository: { object: { file: { object: blob } } } },
        });
      }),
      github.mutation<Record<string, unknown>, { input: CommitInput }>(
        "CommitFileEdit",
        ({ variables }) => {
          commits.push(variables.input);
          return HttpResponse.json({
            data: {
              createCommitOnBranch: { commit: { oid: "c0ffee5ca1ab1e5ca1ab1ec0ffee5ca1ab1e0001" } },
            },
          });
        },
      ),
    );
    return { commits, reads };
  }

  it("replaces the suggested lines at the pinned head and commits through the edit path", async () => {
    const { commits, reads } = blobServer({
      text: lineMapping.head,
      isBinary: false,
      isTruncated: false,
    });
    const affected = [
      [311, "conversation", "octo-org", "hello-mobile", 5],
      [311, "pullFiles", "octo-org", "hello-mobile", 5],
      [311, "reviewThreads", "octo-org", "hello-mobile", 5],
    ];
    const unrelated = [311, "conversation", "octo-org", "other-repo", 5];
    for (const queryKey of [...affected, unrelated]) client.setQueryData(queryKey, {});
    const { result } = renderHook(() => useCommitSuggestion(), { wrapper });
    const outcome = await act(() => result.current.mutateAsync(suggestion));
    expect(affected.map((queryKey) => client.getQueryState(queryKey)?.isInvalidated)).toEqual([
      true,
      true,
      true,
    ]);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    expect(outcome).toEqual({
      kind: "commit",
      owner: OWNER,
      repo: REPO,
      oid: "c0ffee5ca1ab1e5ca1ab1ec0ffee5ca1ab1e0001",
    });
    expect(reads).toEqual([{ owner: OWNER, repo: REPO, oid: HEAD_OID, path: lineMapping.path }]);
    const [commit] = commits;
    expect(commit).toMatchObject({
      branch: { repositoryNameWithOwner: `${OWNER}/${REPO}`, branchName: "feature/i18n" },
      expectedHeadOid: HEAD_OID,
      message: { headline: "Apply suggestion from code review", body: "" },
    });
    const additions = commit?.fileChanges.additions ?? [];
    expect(additions.map((change) => change.path)).toEqual([lineMapping.path]);
    const headLines = lineMapping.head.split("\n");
    const expected = [
      ...headLines.slice(0, 8),
      ...replacement.split("\n").slice(0, 3),
      ...headLines.slice(11),
    ];
    expect(decodeBase64(additions[0]?.contents ?? "")).toBe(expected.join("\n"));
  });

  it("refuses truncated files and ranges outside the file", async () => {
    const truncated = blobServer({ text: "partial", isBinary: false, isTruncated: true });
    const { result } = renderHook(() => useCommitSuggestion(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(suggestion).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.error).toMatchObject({ kind: "validation", fields: ["path"] });
    });
    expect(truncated.commits).toEqual([]);

    const short = blobServer({ text: "one line\n", isBinary: false, isTruncated: false });
    await act(async () => {
      await result.current.mutateAsync(suggestion).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.error).toMatchObject({
        kind: "validation",
        fields: ["startLine", "endLine"],
      });
    });
    expect(short.commits).toEqual([]);
  });
});
