import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { graphql } from "msw/graphql";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "../internal/test-doubles";
import { property } from "../internal/json";
import fixtures from "./fixtures/file-edit.json";
import {
  defaultBranchName,
  diffLines,
  type CommitOutcome,
  type CommitStep,
  type CommitTarget,
} from "./index";

const API = "https://api.github.com";
const {
  COMMITTED_OID,
  ORIGINAL_OID,
  committedFile,
  createdBranch,
  fileEdit,
  forkRepository,
  latestFile,
  openedPullRequest,
  upstreamRepository,
} = fixtures;
const newBranch = { ...fixtures.newBranch, kind: "newBranch" } as const;
const github = graphql.link(`${API}/graphql`);
const requests: { operation: string; variables: unknown }[] = [];
const server = setupServer(
  http.get("/auth/accounts", () =>
    HttpResponse.json([
      {
        id: 700,
        login: "mona",
        avatarUrl: "https://avatars.githubusercontent.com/u/700",
        publicOnly: false,
      },
    ]),
  ),
  http.post("/auth/token", () =>
    HttpResponse.json({
      accessToken: "gho_commit_fixture",
      expiresAt: Date.now() + 3_600_000,
    }),
  ),
  github.query("EditRepository", ({ variables }) => {
    requests.push({ operation: "repository", variables });
    return HttpResponse.json({ data: { repository: upstreamRepository } });
  }),
  github.query("EditForkReady", ({ variables }) => {
    requests.push({ operation: "forkReady", variables });
    return HttpResponse.json({ data: { repository: forkRepository } });
  }),
  github.mutation("CreateEditBranch", ({ variables }) => {
    requests.push({ operation: "branch", variables });
    return HttpResponse.json({ data: createdBranch });
  }),
  github.mutation("CommitFileEdit", ({ variables }) => {
    requests.push({ operation: "commit", variables });
    return HttpResponse.json({ data: committedFile });
  }),
  github.mutation("OpenEditPullRequest", ({ variables }) => {
    requests.push({ operation: "pullRequest", variables });
    return HttpResponse.json({ data: openedPullRequest });
  }),
  github.query("LatestEditFile", ({ variables }) => {
    requests.push({ operation: "latest", variables });
    return HttpResponse.json({ data: latestFile });
  }),
);

async function modules() {
  vi.resetModules();
  return { session: await import("../session"), commit: await import("./index") };
}

function sessionWrapper(session: typeof import("../session")) {
  function SignedIn({ children }: { children: ReactNode }) {
    return session.useSession().activeAccount ? children : null;
  }
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <session.SessionProvider>
        <SignedIn>{children}</SignedIn>
      </session.SessionProvider>
    );
  };
}

async function mountCommit(onStep?: (step: CommitStep) => void) {
  const loaded = await modules();
  const hook = renderHook(() => loaded.commit.useCommitFileEdit(onStep), {
    wrapper: sessionWrapper(loaded.session),
  });
  await waitFor(() => {
    expect(hook.result.current).toBeTruthy();
  });
  return hook;
}

async function submit(target: CommitTarget, onStep?: (step: CommitStep) => void) {
  const hook = await mountCommit(onStep);
  let outcome: CommitOutcome | undefined;
  await act(async () => {
    outcome = await hook.result.current.mutateAsync({ ...fileEdit, target });
  });
  return outcome;
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  requests.length = 0;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});

describe("file edit commits", () => {
  it.each(["newBranch", "fork"] as const)(
    "retries a %s collision and uses the chosen suffix throughout",
    async (kind) => {
      const names: unknown[] = [];
      server.use(
        github.query("EditRepository", () =>
          HttpResponse.json({
            data: {
              repository: { ...upstreamRepository, forks: { nodes: [forkRepository] } },
            },
          }),
        ),
        github.mutation("CreateEditBranch", ({ variables }) => {
          names.push(property(variables.input, "name"));
          const errors = [{ type: "UNPROCESSABLE", message: "Reference already exists" }];
          return names.length < 3
            ? HttpResponse.json({ errors })
            : HttpResponse.json({ data: createdBranch });
        }),
      );
      expect(await submit({ ...newBranch, kind })).toMatchObject({
        kind: "pullRequest",
        number: 42,
      });
      expect(names).toEqual([
        `refs/heads/${newBranch.branchName}`,
        `refs/heads/${newBranch.branchName}-2`,
        `refs/heads/${newBranch.branchName}-3`,
      ]);
      expect(requests.find((request) => request.operation === "commit")?.variables).toMatchObject({
        input: { branch: { branchName: `${newBranch.branchName}-3` } },
      });
      expect(
        requests.find((request) => request.operation === "pullRequest")?.variables,
      ).toMatchObject({
        input: {
          headRefName: `${kind === "fork" ? "mona:" : ""}${newBranch.branchName}-3`,
          ...(kind === "fork" ? { headRepositoryId: forkRepository.id } : {}),
        },
      });
    },
  );

  it.each([false, true])(
    "invalidates only edited repository content and PR work when opened=%s",
    async (openPr) => {
      const loaded = await modules();
      const query = await import("@tanstack/react-query");
      const { result } = renderHook(
        () => ({
          mutation: loaded.commit.useCommitFileEdit(),
          client: query.useQueryClient(),
        }),
        { wrapper: sessionWrapper(loaded.session) },
      );
      await waitFor(() => {
        expect(result.current).toBeTruthy();
      });
      const affected = [
        [700, "file", fileEdit.owner, fileEdit.repo, "main", fileEdit.path],
        [700, "tree", fileEdit.owner, fileEdit.repo, "main", "src"],
        [700, "readme", fileEdit.owner, fileEdit.repo, "main"],
        [700, "commit", "latest", fileEdit.owner, fileEdit.repo, "main", fileEdit.path],
      ];
      const untouched = [
        [700, "file", "other", fileEdit.repo, "main", fileEdit.path],
        [700, "tree", fileEdit.owner, "other", "main", "src"],
        [700, "readme", fileEdit.owner, "other", "main"],
        [700, "commit", "latest", "other", fileEdit.repo, "main", fileEdit.path],
        [701, "file", fileEdit.owner, fileEdit.repo, "main", fileEdit.path],
        [700, "home", "viewer"],
        [700, "inbox", "unread"],
        [700, "repository", fileEdit.owner, fileEdit.repo],
        [700, "refs", "other", fileEdit.repo],
      ];
      const refsKey = [700, "refs", fileEdit.owner, fileEdit.repo];
      for (const key of [...affected, ...untouched, [700, "work"], refsKey])
        result.current.client.setQueryData(key, { cached: true });
      await act(async () => {
        await result.current.mutation.mutateAsync({
          ...fileEdit,
          target: openPr ? newBranch : { kind: "direct" },
        });
      });
      for (const key of affected)
        expect(result.current.client.getQueryState(key)?.isInvalidated).toBe(true);
      for (const key of untouched)
        expect(result.current.client.getQueryState(key)?.isInvalidated).toBe(false);
      expect(result.current.client.getQueryState([700, "work"])?.isInvalidated).toBe(openPr);
      expect(result.current.client.getQueryState(refsKey)?.isInvalidated).toBe(openPr);
    },
  );

  it("does not retry branch failures unrelated to collisions", async () => {
    let attempts = 0;
    server.use(
      github.mutation("CreateEditBranch", () => {
        attempts++;
        const errors = [{ type: "UNPROCESSABLE", message: "Invalid reference name" }];
        return HttpResponse.json({ errors });
      }),
    );
    const hook = await mountCommit();
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ ...fileEdit, target: newBranch }),
      ).rejects.toMatchObject({ kind: "validation" });
    });
    expect(attempts).toBe(1);
    expect(requests.map((request) => request.operation)).toEqual(["repository"]);
  });

  it("commits directly with a pinned head and UTF-8 base64 contents", async () => {
    const steps: CommitStep[] = [];
    expect(await submit({ kind: "direct" }, (step) => steps.push(step))).toEqual({
      kind: "commit",
      owner: "octo-org",
      repo: "hello-mobile",
      oid: COMMITTED_OID,
    });
    expect(steps).toEqual(["committing"]);
    expect(requests).toEqual([
      {
        operation: "commit",
        variables: {
          input: {
            branch: { repositoryNameWithOwner: "octo-org/hello-mobile", branchName: "main" },
            expectedHeadOid: ORIGINAL_OID,
            fileChanges: {
              additions: [
                {
                  path: "src/welcome.ts",
                  contents: "ZXhwb3J0IGNvbnN0IGdyZWV0aW5nID0gIuOBk+OCk+OBq+OBoeOBryDwn4yPIjsK",
                },
              ],
            },
            message: fileEdit.message,
          },
        },
      },
    ]);
  });

  it("creates a branch at the opened head and opens a PR against the original branch", async () => {
    const steps: CommitStep[] = [];
    expect(await submit(newBranch, (step) => steps.push(step))).toEqual({
      kind: "pullRequest",
      owner: "octo-org",
      repo: "hello-mobile",
      number: 42,
    });
    expect(steps).toEqual(["creatingBranch", "committing", "openingPullRequest"]);
    expect(requests.find((request) => request.operation === "branch")?.variables).toEqual({
      input: {
        repositoryId: upstreamRepository.id,
        name: `refs/heads/${newBranch.branchName}`,
        oid: ORIGINAL_OID,
      },
    });
    expect(requests.find((request) => request.operation === "commit")?.variables).toMatchObject({
      input: {
        branch: {
          repositoryNameWithOwner: "octo-org/hello-mobile",
          branchName: newBranch.branchName,
        },
        expectedHeadOid: ORIGINAL_OID,
      },
    });
    expect(requests.find((request) => request.operation === "pullRequest")?.variables).toEqual({
      input: {
        repositoryId: upstreamRepository.id,
        baseRefName: "main",
        headRefName: newBranch.branchName,
        ...newBranch.pullRequest,
      },
    });
  });

  it("creates a fork, waits for readiness and opens an upstream PR with the fork head id", async () => {
    let forkBody: unknown;
    server.use(
      http.post(`${API}/repos/octo-org/hello-mobile/forks`, async ({ request }) => {
        forkBody = await request.json();
        return HttpResponse.json(
          { name: "hello-mobile", owner: { login: "mona" } },
          { status: 202 },
        );
      }),
    );
    const steps: CommitStep[] = [];
    expect(await submit({ ...newBranch, kind: "fork" }, (step) => steps.push(step))).toMatchObject({
      kind: "pullRequest",
      number: 42,
    });
    expect(forkBody).toEqual({ default_branch_only: false });
    expect(steps).toEqual([
      "forking",
      "waitingForFork",
      "creatingBranch",
      "committing",
      "openingPullRequest",
    ]);
    expect(requests.find((request) => request.operation === "branch")?.variables).toMatchObject({
      input: {
        repositoryId: forkRepository.id,
        oid: ORIGINAL_OID,
      },
    });
    expect(requests.find((request) => request.operation === "commit")?.variables).toMatchObject({
      input: {
        branch: {
          repositoryNameWithOwner: "mona/hello-mobile",
          branchName: newBranch.branchName,
        },
      },
    });
    expect(requests.find((request) => request.operation === "pullRequest")?.variables).toEqual({
      input: {
        repositoryId: upstreamRepository.id,
        headRepositoryId: forkRepository.id,
        baseRefName: "main",
        headRefName: `mona:${newBranch.branchName}`,
        ...newBranch.pullRequest,
      },
    });
  });

  it("reuses an existing viewer fork", async () => {
    server.use(
      github.query("EditRepository", () =>
        HttpResponse.json({
          data: {
            repository: { ...upstreamRepository, forks: { nodes: [forkRepository] } },
          },
        }),
      ),
    );
    const steps: CommitStep[] = [];
    await submit({ ...newBranch, kind: "fork" }, (step) => steps.push(step));
    expect(steps).toEqual(["creatingBranch", "committing", "openingPullRequest"]);
    expect(requests.some((request) => request.operation === "forkReady")).toBe(false);
  });

  it("syncs an existing fork only when the upstream commit is unavailable", async () => {
    let attempts = 0;
    let syncBody: unknown;
    server.use(
      github.query("EditRepository", () =>
        HttpResponse.json({
          data: {
            repository: { ...upstreamRepository, forks: { nodes: [forkRepository] } },
          },
        }),
      ),
      github.mutation("CreateEditBranch", () => {
        attempts++;
        const errors = [
          {
            type: "UNPROCESSABLE",
            message: "Could not resolve to a commit with the oid of the upstream head",
          },
        ];
        return attempts === 1
          ? HttpResponse.json({ errors })
          : HttpResponse.json({ data: createdBranch });
      }),
      http.post(`${API}/repos/mona/hello-mobile/merge-upstream`, async ({ request }) => {
        syncBody = await request.json();
        return HttpResponse.json({ merge_type: "fast-forward", base_branch: "octo-org:main" });
      }),
    );
    await submit({ ...newBranch, kind: "fork" });
    expect(syncBody).toEqual({ branch: "main" });
    expect(attempts).toBe(2);
  });

  it("waits through an unready fork and a temporary not-found response", async () => {
    let attempts = 0;
    const times: number[] = [];
    server.use(
      github.query("EditRepository", () =>
        HttpResponse.json({
          data: {
            repository: {
              ...upstreamRepository,
              forks: { nodes: [{ ...forkRepository, defaultBranchRef: null }] },
            },
          },
        }),
      ),
      github.query("EditForkReady", () => {
        attempts++;
        times.push(Date.now());
        const errors = [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }];
        if (attempts === 2) return HttpResponse.json({ errors });
        return HttpResponse.json({
          data: {
            repository:
              attempts === 1 ? { ...forkRepository, defaultBranchRef: null } : forkRepository,
          },
        });
      }),
    );
    const steps: CommitStep[] = [];
    const hook = await mountCommit((step) => {
      steps.push(step);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    await act(async () => {
      const outcome = hook.result.current.mutateAsync({
        ...fileEdit,
        target: { ...newBranch, kind: "fork" },
      });
      await vi.waitFor(() => {
        expect(attempts).toBe(1);
      });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(await outcome).toMatchObject({ kind: "pullRequest", number: 42 });
    });
    expect(attempts).toBe(3);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(1000);
    expect((times[2] ?? 0) - (times[1] ?? 0)).toBeGreaterThanOrEqual(2000);
    expect(steps).toEqual(["waitingForFork", "creatingBranch", "committing", "openingPullRequest"]);
  });

  it("bounds readiness polling and never commits to an unready fork", async () => {
    let attempts = 0;
    server.use(
      github.query("EditRepository", () =>
        HttpResponse.json({
          data: {
            repository: {
              ...upstreamRepository,
              forks: { nodes: [{ ...forkRepository, defaultBranchRef: null }] },
            },
          },
        }),
      ),
      github.query("EditForkReady", () => {
        attempts++;
        return HttpResponse.json({ data: { repository: null } });
      }),
    );
    const hook = await mountCommit();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    await act(async () => {
      const outcome = hook.result.current
        .mutateAsync({ ...fileEdit, target: { ...newBranch, kind: "fork" } })
        .catch((error: unknown) => error);
      await vi.waitFor(() => {
        expect(attempts).toBe(1);
      });
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await outcome).toMatchObject({ kind: "server", status: 202 });
    });
    expect(attempts).toBe(7);
    expect(requests).toEqual([]);
  });

  it("stops after bounded branch collisions without touching the original branch", async () => {
    const errors = [{ type: "UNPROCESSABLE", message: "Reference already exists" }];
    const names: unknown[] = [];
    server.use(
      github.mutation("CreateEditBranch", ({ variables }) => {
        names.push(property(variables.input, "name"));
        return HttpResponse.json({ errors });
      }),
    );
    const hook = await mountCommit();
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ ...fileEdit, target: newBranch }),
      ).rejects.toMatchObject({ kind: "validation" });
    });
    expect(names).toEqual([
      `refs/heads/${newBranch.branchName}`,
      `refs/heads/${newBranch.branchName}-2`,
      `refs/heads/${newBranch.branchName}-3`,
    ]);
    expect(requests.map((request) => request.operation)).toEqual(["repository"]);
  });

  it("preserves a created commit when opening the PR fails without retrying writes", async () => {
    let attempts = 0;
    const errors = [{ type: "FORBIDDEN", message: "Pull request creation is disabled" }];
    server.use(
      github.mutation("OpenEditPullRequest", () => {
        attempts++;
        return HttpResponse.json({ errors });
      }),
    );
    const hook = await mountCommit();
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ ...fileEdit, target: newBranch }),
      ).rejects.toMatchObject({ kind: "forbidden" });
    });
    expect(attempts).toBe(1);
    expect(requests.map((request) => request.operation)).toEqual([
      "repository",
      "branch",
      "commit",
    ]);
  });

  it.each([
    ["UNPROCESSABLE", "Expected branch to point to expectedHeadOid", "conflict"],
    [
      "UNPROCESSABLE",
      "Expected branch to point to abc123 but it did not. Pull and try again.",
      "conflict",
    ],
    ["STALE_DATA", "The head moved", "conflict"],
    ["UNPROCESSABLE", "Protected branch update failed: required checks", "forbidden"],
    ["FORBIDDEN", "Repository rule violations found", "forbidden"],
    ["UNPROCESSABLE", "File path is invalid", "validation"],
  ])("maps %s %s to %s without retrying the write", async (type, message, kind) => {
    let attempts = 0;
    server.use(
      github.mutation("CommitFileEdit", () => {
        attempts++;
        const errors = [{ type, message }];
        return HttpResponse.json({ errors });
      }),
    );
    const hook = await mountCommit();
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({ ...fileEdit, target: { kind: "direct" } }),
      ).rejects.toMatchObject({ kind });
    });
    expect(attempts).toBe(1);
    expect(requests.some((request) => request.operation === "pullRequest")).toBe(false);
  });
});

describe("latest file", () => {
  it("loads content from the same commit as the returned head, only when enabled", async () => {
    const loaded = await modules();
    const hook = renderHook(
      ({ enabled }) =>
        loaded.commit.useLatestFile(
          "octo-org",
          "hello-mobile",
          "feature/docs",
          "src/welcome.ts",
          enabled,
        ),
      { wrapper: sessionWrapper(loaded.session), initialProps: { enabled: false } },
    );
    await waitFor(() => {
      expect(hook.result.current).toBeTruthy();
    });
    expect(requests).toEqual([]);
    hook.rerender({ enabled: true });
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(hook.result.current.data).toEqual({
      text: 'export const greeting = "Hello!";\n',
      headOid: COMMITTED_OID,
    });
    expect(requests).toEqual([
      {
        operation: "latest",
        variables: {
          owner: "octo-org",
          repo: "hello-mobile",
          ref: "refs/heads/feature/docs",
          path: "src/welcome.ts",
        },
      },
    ]);
  });

  it.each([
    [null, "notFound"],
    [{ __typename: "Blob", isBinary: true, text: null }, "validation"],
  ])("rejects missing or binary latest file %s", async (object, kind) => {
    server.use(
      github.query("LatestEditFile", () =>
        HttpResponse.json({
          data: {
            repository: {
              ref: { target: { __typename: "Commit", oid: COMMITTED_OID, file: { object } } },
            },
          },
        }),
      ),
    );
    const loaded = await modules();
    const hook = renderHook(
      () => loaded.commit.useLatestFile("octo-org", "hello-mobile", "main", "src/welcome.ts", true),
      { wrapper: sessionWrapper(loaded.session) },
    );
    await waitFor(() => {
      expect(hook.result.current.isError).toBe(true);
    });
    expect(hook.result.current.error).toMatchObject({ kind });
  });
});

describe("default branch names", () => {
  it("uses a short local date and sanitizes invalid ref characters", () => {
    const date = new Date(2026, 10, 17, 12);
    expect(defaultBranchName("mona", "src/welcome.ts", date)).toBe("ghm/mona/20261117-welcome");
    expect(defaultBranchName("a..b@{x}", "dir/[bad] file.lock.ts", date)).toBe(
      "ghm/a-b-x/20261117-bad-file-lock",
    );
    expect(defaultBranchName("", "...", date)).toBe("ghm/user/20261117-file");
    expect(defaultBranchName("mona", ".gitignore", date)).toBe("ghm/mona/20261117-gitignore");
  });
});

describe("line diff", () => {
  it("retains context and numbers insertions and deletions independently", () => {
    expect(diffLines("same\nold\ntail", "same\nnew\nextra\ntail")).toEqual([
      { kind: "context", text: "same", oldLine: 1, newLine: 1 },
      { kind: "del", text: "old", oldLine: 2, newLine: null },
      { kind: "add", text: "new", oldLine: null, newLine: 2 },
      { kind: "add", text: "extra", oldLine: null, newLine: 3 },
      { kind: "context", text: "tail", oldLine: 3, newLine: 4 },
    ]);
  });
  it("handles empty files and preserves trailing blank lines", () => {
    expect(diffLines("", "")).toEqual([]);
    expect(diffLines("", "hello\n")).toEqual([
      { kind: "add", text: "hello", oldLine: null, newLine: 1 },
      { kind: "add", text: "", oldLine: null, newLine: 2 },
    ]);
    expect(diffLines("hello", "")).toEqual([
      { kind: "del", text: "hello", oldLine: 1, newLine: null },
    ]);
    expect(diffLines("a\n", "a")).toEqual([
      { kind: "context", text: "a", oldLine: 1, newLine: 1 },
      { kind: "del", text: "", oldLine: 2, newLine: null },
    ]);
  });
  it("preserves matching interior lines across multiple edits", () => {
    const diff = diffLines("start\na\nkeep\nb\nend", "new-start\nx\nkeep\ny\nnew-end");
    expect(diff.filter((line) => line.kind === "context")).toEqual([
      { kind: "context", text: "keep", oldLine: 3, newLine: 3 },
    ]);
    expect(
      diff
        .filter((line) => line.kind !== "add")
        .map((line) => line.text)
        .join("\n"),
    ).toBe("start\na\nkeep\nb\nend");
    expect(
      diff
        .filter((line) => line.kind !== "del")
        .map((line) => line.text)
        .join("\n"),
    ).toBe("new-start\nx\nkeep\ny\nnew-end");
  });
});
