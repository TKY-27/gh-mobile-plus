import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { graphql } from "msw/graphql";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { property } from "../internal/json";
import { installBrowserDoubles } from "../internal/test-doubles";
import fixtures from "./fixtures/file-edit.json";
import {
  ancestorPaths,
  createFileFailure,
  isContentWithinLimit,
  MAX_FILE_BYTES,
  MAX_FILE_PATH_LENGTH,
  newFileDraftKey,
  validateNewFilePath,
  type CommitOutcome,
  type CommitTarget,
  type CreateFileStep,
} from "./index";

const API = "https://api.github.com";
const {
  COMMITTED_OID,
  ORIGINAL_OID,
  committedFile,
  createdBranch,
  forkRepository,
  openedPullRequest,
  upstreamRepository,
} = fixtures;
const NEW_BRANCH: CommitTarget = {
  kind: "newBranch",
  branchName: "ghm/mona/20261119-notes",
  pullRequest: { title: "Create notes.md", body: "Add project notes." },
};
const github = graphql.link(`${API}/graphql`);
const requests: { operation: string; variables: unknown }[] = [];
let accountPublicOnly = false;

function eligibleRepoPayload(overrides: Record<string, unknown> = {}) {
  return {
    hasPullRequestsEnabled: true,
    isPrivate: false,
    isArchived: false,
    isDisabled: false,
    isLocked: false,
    isEmpty: false,
    forkingAllowed: true,
    viewerPermission: "WRITE",
    ref: {
      prefix: "refs/heads/",
      target: {
        __typename: "Commit",
        oid: ORIGINAL_OID,
        file: null,
        parent: { type: "tree" },
      },
    },
    directory: { __typename: "Tree" },
    ...overrides,
  };
}

const server = setupServer(
  http.get("/auth/accounts", () =>
    HttpResponse.json([
      {
        id: 710,
        login: "mona",
        avatarUrl: "https://avatars.githubusercontent.com/u/710",
        publicOnly: accountPublicOnly,
      },
    ]),
  ),
  http.post("/auth/token", () =>
    HttpResponse.json({
      accessToken: "gho_create_fixture",
      expiresAt: Date.now() + 3_600_000,
    }),
  ),
  github.query("CreateFileContext", ({ variables }) => {
    requests.push({ operation: "context", variables });
    return HttpResponse.json({ data: { repository: eligibleRepoPayload() } });
  }),
  github.query("CheckNewFilePath", ({ variables }) => {
    requests.push({ operation: "checkPath", variables });
    return HttpResponse.json({ data: { repository: eligibleRepoPayload() } });
  }),
  github.query("CheckCommitEntry", ({ variables }) => {
    requests.push({ operation: "checkEntry", variables });
    return HttpResponse.json({
      data: { repository: { object: { __typename: "Commit", file: { type: "tree" } } } },
    });
  }),
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

async function mountCreate(onStep?: (step: CreateFileStep) => void) {
  const loaded = await modules();
  const hook = renderHook(() => loaded.commit.useCreateFile(onStep), {
    wrapper: sessionWrapper(loaded.session),
  });
  await waitFor(() => {
    expect(hook.result.current).toBeTruthy();
  });
  return hook;
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  requests.length = 0;
  accountPublicOnly = false;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("file path and content validation", () => {
  it("accepts valid root, nested, dotfiles and Unicode paths", () => {
    expect(validateNewFilePath("", "README.md")).toEqual({
      ok: true,
      path: "README.md",
      name: "README.md",
    });
    expect(validateNewFilePath("src", "nested/日本語.ts")).toEqual({
      ok: true,
      path: "src/nested/日本語.ts",
      name: "日本語.ts",
    });
    expect(validateNewFilePath("/src/", ".github/workflows/ci.yml")).toEqual({
      ok: true,
      path: "src/.github/workflows/ci.yml",
      name: "ci.yml",
    });
    expect(validateNewFilePath("", ".gitignore")).toEqual({
      ok: true,
      path: ".gitignore",
      name: ".gitignore",
    });
  });

  it.each([
    ["", "", "empty"],
    ["", "   ", "empty"],
    ["", "/notes.md", "emptySegment"],
    ["", "dir/", "emptySegment"],
    ["", "a//b.ts", "emptySegment"],
    ["", "a/ /b.ts", "emptySegment"],
    ["", ".", "dotSegment"],
    ["", "..", "dotSegment"],
    ["src", "../secret.ts", "dotSegment"],
    ["../escape", "file.ts", "dotSegment"],
    ["", ".git", "reservedGit"],
    ["", "sub/.GIT/config", "reservedGit"],
    ["", "a\\b.ts", "invalidCharacters"],
    ["", "notes.md\n", "invalidCharacters"],
    ["", "bad\u0000name", "invalidCharacters"],
    ["", "a".repeat(MAX_FILE_PATH_LENGTH + 1), "tooLong"],
  ] as const)("rejects (%s, %s) as %s", (directory, input, error) => {
    expect(validateNewFilePath(directory, input)).toEqual({ ok: false, error });
  });

  it("computes ancestors deepest-first and enforces UTF-8 byte size limits", () => {
    expect(ancestorPaths("file.ts")).toEqual([]);
    expect(ancestorPaths("src/utils/deep/file.ts")).toEqual(["src/utils/deep", "src/utils", "src"]);
    expect(isContentWithinLimit("")).toBe(true);
    expect(isContentWithinLimit("a".repeat(MAX_FILE_BYTES))).toBe(true);
    expect(isContentWithinLimit("a".repeat(MAX_FILE_BYTES + 1))).toBe(false);
    // Multi-byte UTF-8 exceeds the byte limit.
    expect(isContentWithinLimit("あ".repeat(Math.floor(MAX_FILE_BYTES / 3) + 1))).toBe(false);
  });

  it("isolates draft keys across branch and directory boundaries", () => {
    expect(newFileDraftKey("o", "r", "a/b", "c")).not.toBe(newFileDraftKey("o", "r", "a", "b/c"));
    expect(newFileDraftKey("o", "r", "main", "/src/")).toBe(
      newFileDraftKey("o", "r", "main", "src"),
    );
  });
});

describe("create file context eligibility", () => {
  it("reports eligible branch with push access and directory verification", async () => {
    const loaded = await modules();
    const hook = renderHook(
      () =>
        loaded.commit.useCreateFileContext("octo-org", "hello-mobile", "refs/heads/main", "src"),
      { wrapper: sessionWrapper(loaded.session) },
    );
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(hook.result.current.data).toEqual({
      eligible: true,
      branch: "main",
      directory: "src",
      headOid: ORIGINAL_OID,
      canPush: true,
      canProposePull: true,
    });
    expect(requests).toEqual([
      {
        operation: "context",
        variables: {
          owner: "octo-org",
          repo: "hello-mobile",
          branchRef: "refs/heads/main",
          directoryExpression: "refs/heads/main:src",
          hasDirectory: true,
        },
      },
    ]);
  });

  it("allows forkable read-only repositories with canPush=false", async () => {
    server.use(
      github.query("CreateFileContext", () =>
        HttpResponse.json({
          data: {
            repository: eligibleRepoPayload({ viewerPermission: "READ", forkingAllowed: true }),
          },
        }),
      ),
    );
    const loaded = await modules();
    const hook = renderHook(
      () => loaded.commit.useCreateFileContext("octo-org", "hello-mobile", "main", ""),
      { wrapper: sessionWrapper(loaded.session) },
    );
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(hook.result.current.data).toEqual({
      eligible: true,
      branch: "main",
      directory: "",
      headOid: ORIGINAL_OID,
      canPush: false,
      canProposePull: true,
    });
  });

  it("rejects qualified tag refs immediately without querying GitHub", async () => {
    const loaded = await modules();
    const hook = renderHook(
      () =>
        loaded.commit.useCreateFileContext("octo-org", "hello-mobile", "refs/tags/v1.0.0", "src"),
      { wrapper: sessionWrapper(loaded.session) },
    );
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(hook.result.current.data).toEqual({ eligible: false, reason: "notBranch" });
    expect(requests).toEqual([]);
  });

  it.each([
    [{ isArchived: true }, "archived"],
    [{ isDisabled: true }, "readOnly"],
    [{ isLocked: true }, "readOnly"],
    [{ isEmpty: true }, "emptyRepository"],
    [{ viewerPermission: "READ", forkingAllowed: false }, "noPermission"],
    [{ ref: null }, "notBranch"],
    [{ directory: { __typename: "Blob" } }, "notDirectory"],
  ] as const)("marks repository ineligible with reason %s", async (overrides, reason) => {
    server.use(
      github.query("CreateFileContext", () =>
        HttpResponse.json({ data: { repository: eligibleRepoPayload(overrides) } }),
      ),
    );
    const loaded = await modules();
    const hook = renderHook(
      () => loaded.commit.useCreateFileContext("octo-org", "hello-mobile", "main", "src"),
      { wrapper: sessionWrapper(loaded.session) },
    );
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(hook.result.current.data).toEqual({ eligible: false, reason });
  });

  it("blocks private repositories for public-only accounts even with WRITE permission", async () => {
    accountPublicOnly = true;
    server.use(
      github.query("CreateFileContext", () =>
        HttpResponse.json({
          data: { repository: eligibleRepoPayload({ isPrivate: true, viewerPermission: "WRITE" }) },
        }),
      ),
    );
    const loaded = await modules();
    const hook = renderHook(
      () => loaded.commit.useCreateFileContext("octo-org", "hello-mobile", "main", ""),
      { wrapper: sessionWrapper(loaded.session) },
    );
    await waitFor(() => {
      expect(hook.result.current.isSuccess).toBe(true);
    });
    expect(hook.result.current.data).toEqual({ eligible: false, reason: "noPermission" });
  });
});

describe("race-free file creation commits", () => {
  it("checks existence and commits directly using the exact same verified head", async () => {
    const steps: CreateFileStep[] = [];
    const hook = await mountCreate((step) => steps.push(step));
    let outcome: CommitOutcome | undefined;
    await act(async () => {
      outcome = await hook.result.current.mutateAsync({
        owner: "octo-org",
        repo: "hello-mobile",
        branch: "main",
        path: "src/.gitkeep",
        content: "",
        message: { headline: "Create .gitkeep", body: "" },
        target: { kind: "direct" },
      });
    });
    expect(outcome).toEqual({
      kind: "commit",
      owner: "octo-org",
      repo: "hello-mobile",
      oid: COMMITTED_OID,
    });
    expect(steps).toEqual(["checkingPath", "committing"]);
    expect(requests).toEqual([
      {
        operation: "checkPath",
        variables: {
          owner: "octo-org",
          repo: "hello-mobile",
          ref: "refs/heads/main",
          path: "src/.gitkeep",
          parentPath: "src",
          hasParent: true,
        },
      },
      {
        operation: "commit",
        variables: {
          input: {
            branch: { repositoryNameWithOwner: "octo-org/hello-mobile", branchName: "main" },
            expectedHeadOid: ORIGINAL_OID,
            fileChanges: { additions: [{ path: "src/.gitkeep", contents: "" }] },
            message: { headline: "Create .gitkeep", body: "" },
          },
        },
      },
    ]);
  });

  it("blocks proposals before writing when the repository disables pulls", async () => {
    server.use(
      github.query("CheckNewFilePath", () =>
        HttpResponse.json({
          data: {
            repository: eligibleRepoPayload({ hasPullRequestsEnabled: false }),
          },
        }),
      ),
    );
    const hook = await mountCreate();
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync({
          owner: "octo-org",
          repo: "hello-mobile",
          branch: "main",
          path: "notes.md",
          content: "Notes",
          message: { headline: "Add notes", body: "" },
          target: NEW_BRANCH,
        }),
      ).rejects.toMatchObject({ kind: "forbidden" });
    });
    expect(requests).toHaveLength(0);
  });

  it("uses the new commit and PR descriptions when a retried creation branch is still empty", async () => {
    const messages: unknown[] = [];
    server.use(
      github.mutation("CommitFileEdit", ({ variables }) => {
        messages.push(property(variables.input, "message"));
        return messages.length === 1
          ? HttpResponse.error()
          : HttpResponse.json({ data: committedFile });
      }),
      github.query("EditProposalHead", () =>
        HttpResponse.json({
          data: {
            repository: { ref: { target: { __typename: "Commit", oid: ORIGINAL_OID } } },
          },
        }),
      ),
    );
    const creation = {
      owner: "octo-org",
      repo: "hello-mobile",
      branch: "main",
      path: "notes.md",
      content: "Notes",
      message: { headline: "Add notes", body: "" },
      target: NEW_BRANCH,
    };
    const revised = {
      ...creation,
      message: { headline: "Document notes", body: "New details" },
      target: {
        ...NEW_BRANCH,
        kind: "newBranch" as const,
        pullRequest: { title: "Documentation", body: "Updated proposal" },
      },
    };
    const hook = await mountCreate();
    await act(async () => {
      await expect(hook.result.current.mutateAsync(creation)).rejects.toMatchObject({
        kind: "network",
      });
      await expect(hook.result.current.mutateAsync(revised)).resolves.toMatchObject({ number: 42 });
    });
    expect(messages).toEqual([creation.message, revised.message]);
    expect(requests.filter(({ operation }) => operation === "branch")).toHaveLength(1);
    expect(requests.filter(({ operation }) => operation === "checkPath")).toHaveLength(1);
    expect(requests.find(({ operation }) => operation === "pullRequest")?.variables).toMatchObject({
      input: revised.target.pullRequest,
    });
  });

  it("pins new branch creation and commit to the verified head from existence check", async () => {
    const movedHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    server.use(
      github.query("CheckNewFilePath", ({ variables }) => {
        requests.push({ operation: "checkPath", variables });
        return HttpResponse.json({
          data: {
            repository: eligibleRepoPayload({
              ref: {
                prefix: "refs/heads/",
                target: {
                  __typename: "Commit",
                  oid: movedHead,
                  file: null,
                  parent: { type: "tree" },
                },
              },
            }),
          },
        });
      }),
    );
    const steps: CreateFileStep[] = [];
    const hook = await mountCreate((step) => steps.push(step));
    let outcome: CommitOutcome | undefined;
    await act(async () => {
      outcome = await hook.result.current.mutateAsync({
        owner: "octo-org",
        repo: "hello-mobile",
        branch: "main",
        path: "src/notes.md",
        content: "# Notes\n",
        message: { headline: "Create notes.md", body: "Add project notes." },
        target: NEW_BRANCH,
      });
    });
    expect(outcome).toEqual({
      kind: "pullRequest",
      owner: "octo-org",
      repo: "hello-mobile",
      number: 42,
    });
    expect(steps).toEqual(["checkingPath", "creatingBranch", "committing", "openingPullRequest"]);
    expect(requests.find((request) => request.operation === "branch")?.variables).toEqual({
      input: {
        repositoryId: upstreamRepository.id,
        name: `refs/heads/${NEW_BRANCH.branchName}`,
        oid: movedHead,
      },
    });
    expect(requests.find((request) => request.operation === "commit")?.variables).toMatchObject({
      input: {
        expectedHeadOid: movedHead,
        fileChanges: { additions: [{ path: "src/notes.md" }] },
      },
    });
  });

  it("forks and opens a PR for non-push users when forking is allowed", async () => {
    server.use(
      github.query("CheckNewFilePath", ({ variables }) => {
        requests.push({ operation: "checkPath", variables });
        return HttpResponse.json({
          data: {
            repository: eligibleRepoPayload({ viewerPermission: "READ", forkingAllowed: true }),
          },
        });
      }),
      http.post(`${API}/repos/octo-org/hello-mobile/forks`, () =>
        HttpResponse.json(
          { name: forkRepository.name, owner: forkRepository.owner },
          { status: 202 },
        ),
      ),
    );
    const steps: CreateFileStep[] = [];
    const hook = await mountCreate((step) => steps.push(step));
    let outcome: CommitOutcome | undefined;
    await act(async () => {
      outcome = await hook.result.current.mutateAsync({
        owner: "octo-org",
        repo: "hello-mobile",
        branch: "main",
        path: "notes.md",
        content: "hello",
        message: { headline: "Create notes.md", body: "" },
        target: { ...NEW_BRANCH, kind: "fork" },
      });
    });
    expect(outcome).toMatchObject({ kind: "pullRequest", number: 42 });
    expect(steps).toEqual([
      "checkingPath",
      "forking",
      "waitingForFork",
      "creatingBranch",
      "committing",
      "openingPullRequest",
    ]);
  });

  it.each(["blob", "tree"] as const)(
    "blocks overwriting an existing %s at the target path with zero write calls",
    async (entryType) => {
      server.use(
        github.query("CheckNewFilePath", ({ variables }) => {
          requests.push({ operation: "checkPath", variables });
          return HttpResponse.json({
            data: {
              repository: eligibleRepoPayload({
                ref: {
                  prefix: "refs/heads/",
                  target: {
                    __typename: "Commit",
                    oid: ORIGINAL_OID,
                    file: { type: entryType },
                    parent: { type: "tree" },
                  },
                },
              }),
            },
          });
        }),
      );
      const hook = await mountCreate();
      let thrown: unknown;
      await act(async () => {
        thrown = await hook.result.current
          .mutateAsync({
            owner: "octo-org",
            repo: "hello-mobile",
            branch: "main",
            path: "src/alpha.ts",
            content: "new",
            message: { headline: "Create alpha.ts", body: "" },
            target: { kind: "direct" },
          })
          .catch((error: unknown) => error);
      });
      expect(thrown).toMatchObject({ kind: "conflict" });
      expect(createFileFailure(thrown)).toEqual({ reason: "pathExists", path: "src/alpha.ts" });
      expect(requests.map((request) => request.operation)).toEqual(["checkPath"]);
    },
  );

  it("blocks when a higher ancestor is an existing file on the same expected head", async () => {
    server.use(
      github.query("CheckNewFilePath", ({ variables }) => {
        requests.push({ operation: "checkPath", variables });
        return HttpResponse.json({
          data: {
            repository: eligibleRepoPayload({
              ref: {
                prefix: "refs/heads/",
                target: { __typename: "Commit", oid: ORIGINAL_OID, file: null, parent: null },
              },
            }),
          },
        });
      }),
      github.query("CheckCommitEntry", ({ variables }) => {
        requests.push({ operation: "checkEntry", variables });
        return HttpResponse.json({
          data: {
            repository: {
              object: {
                __typename: "Commit",
                file: variables.path === "src/alpha.ts" ? { type: "blob" } : null,
              },
            },
          },
        });
      }),
    );
    const hook = await mountCreate();
    let thrown: unknown;
    await act(async () => {
      thrown = await hook.result.current
        .mutateAsync({
          owner: "octo-org",
          repo: "hello-mobile",
          branch: "main",
          path: "src/alpha.ts/sub/new.ts",
          content: "x",
          message: { headline: "Create new.ts", body: "" },
          target: { kind: "direct" },
        })
        .catch((error: unknown) => error);
    });
    expect(thrown).toMatchObject({ kind: "conflict" });
    expect(createFileFailure(thrown)).toEqual({
      reason: "ancestorConflict",
      path: "src/alpha.ts",
    });
    expect(requests).toEqual([
      {
        operation: "checkPath",
        variables: {
          owner: "octo-org",
          repo: "hello-mobile",
          ref: "refs/heads/main",
          path: "src/alpha.ts/sub/new.ts",
          parentPath: "src/alpha.ts/sub",
          hasParent: true,
        },
      },
      {
        operation: "checkEntry",
        variables: {
          owner: "octo-org",
          repo: "hello-mobile",
          oid: ORIGINAL_OID,
          path: "src/alpha.ts",
        },
      },
    ]);
  });

  it("surfaces a head-moved race when the branch changes between check and commit", async () => {
    let commits = 0;
    server.use(
      github.mutation("CommitFileEdit", () => {
        commits++;
        const errors = [
          { type: "STALE_DATA", message: "Expected branch to point to original oid" },
        ];
        return HttpResponse.json({ errors });
      }),
    );
    const hook = await mountCreate();
    let thrown: unknown;
    await act(async () => {
      thrown = await hook.result.current
        .mutateAsync({
          owner: "octo-org",
          repo: "hello-mobile",
          branch: "main",
          path: "src/new.ts",
          content: "export const n = 1;\n",
          message: { headline: "Create new.ts", body: "" },
          target: { kind: "direct" },
        })
        .catch((error: unknown) => error);
    });
    expect(thrown).toMatchObject({ kind: "conflict" });
    expect(createFileFailure(thrown)).toBeNull();
    expect(commits).toBe(1);
  });

  it("enforces permissions and validation before issuing writes", async () => {
    server.use(
      github.query("CheckNewFilePath", ({ variables }) => {
        requests.push({ operation: "checkPath", variables });
        return HttpResponse.json({
          data: { repository: eligibleRepoPayload({ viewerPermission: "READ" }) },
        });
      }),
    );
    const hook = await mountCreate();
    let noPushError: unknown;
    await act(async () => {
      noPushError = await hook.result.current
        .mutateAsync({
          owner: "octo-org",
          repo: "hello-mobile",
          branch: "main",
          path: "notes.md",
          content: "hi",
          message: { headline: "Create notes.md", body: "" },
          target: { kind: "direct" },
        })
        .catch((error: unknown) => error);
    });
    expect(noPushError).toMatchObject({ kind: "forbidden" });
    expect(createFileFailure(noPushError)).toEqual({ reason: "noPermission" });
    expect(requests.map((request) => request.operation)).toEqual(["checkPath"]);

    requests.length = 0;
    let invalidError: unknown;
    await act(async () => {
      invalidError = await hook.result.current
        .mutateAsync({
          owner: "octo-org",
          repo: "hello-mobile",
          branch: "main",
          path: "../escape.ts",
          content: "hi",
          message: { headline: "Create", body: "" },
          target: { kind: "direct" },
        })
        .catch((error: unknown) => error);
    });
    expect(invalidError).toMatchObject({ kind: "validation", fields: ["path"] });
    expect(requests).toEqual([]);
  });
});
