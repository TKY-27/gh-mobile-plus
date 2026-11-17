import {
  dehydrate,
  hydrate,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { graphql } from "msw/graphql";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "../internal/test-doubles";
import fileFixture from "./fixtures/file.json";
import imageFixture from "./fixtures/private-image.json";
import readmeFixture from "./fixtures/readme.json";
import refsFixture from "./fixtures/refs.json";
import releaseFixture from "./fixtures/release-detail.json";
import releasesFixture from "./fixtures/releases.json";
import repositoryFixture from "./fixtures/repository.json";
import treeFixture from "./fixtures/tree.json";
import trailingNewlineFixture from "./fixtures/trailing-newline.json";
import {
  languageForPath,
  permalink,
  useFile,
  useReadme,
  useRefs,
  useRelease,
  useReleases,
  useRenderMarkdown,
  useRepository,
  useResolvedRefPath,
  useStar,
  useTree,
  useWatch,
} from ".";

vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 310, login: "mona" }) }));

const API = "https://api.github.com";
const github = graphql.link(`${API}/graphql`);
const OWNER = "octo-org";
const REPO = "hello-mobile";
const server = setupServer(
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_repo_fixture", expiresAt: null }),
  ),
);
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
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
  onlineManager.setOnline(true);
  client.clear();
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});

describe("repository screens", () => {
  it("maps the repository header and permissions in one request", async () => {
    let requests = 0;
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("Repository", () => {
        requests++;
        return HttpResponse.json(repositoryFixture);
      }),
    );
    const { result } = renderHook(() => useRepository(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({
      owner: OWNER,
      name: REPO,
      description: "A small mobile-friendly project.",
      isPrivate: false,
      isFork: true,
      parent: { owner: "mona", name: REPO },
      stars: 42,
      forks: 7,
      watchers: 3,
      language: { name: "TypeScript", color: "#3178c6" },
      license: "MIT License",
      defaultBranch: "main",
      viewerHasStarred: false,
      viewerSubscription: "unsubscribed",
      viewerCanPush: true,
      allowedMergeMethods: ["squash", "merge"],
      hasIssues: true,
      webUrl: `https://github.com/${OWNER}/${REPO}`,
    });
    expect(requests).toBe(1);
    expect(
      client.getQueryCache().find({ queryKey: [310, "repository", OWNER, REPO] })?.meta?.private,
    ).toBe(true);
  });

  it("puts the default branch first and keeps tags", async () => {
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("RepositoryRefs", () =>
        HttpResponse.json(refsFixture),
      ),
    );
    const { result } = renderHook(() => useRefs(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({
      branches: ["main", "feature/navigation", "release"],
      tags: ["v1.0.0"],
      truncated: false,
    });
  });

  it("pages matching branches without fetching completed tags again", async () => {
    const requests: unknown[] = [];
    server.use(
      github.query<Record<string, unknown>>("RepositoryRefs", ({ variables }) => {
        requests.push(variables);
        return HttpResponse.json({
          data: {
            repository: {
              defaultBranchRef: { name: "main" },
              branches: variables.branchesAfter
                ? {
                    nodes: [{ name: "feature/navigation" }],
                    pageInfo: { hasNextPage: false, endCursor: "end" },
                  }
                : {
                    nodes: Array.from({ length: 100 }, (_, index) => ({
                      name: `feature/flag-${String(index)}`,
                    })),
                    pageInfo: { hasNextPage: true, endCursor: "next-branch" },
                  },
              ...(variables.withTags
                ? { tags: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }
                : {}),
            },
          },
        });
      }),
    );
    const { result } = renderHook(() => useRefs(OWNER, REPO, "feature/"), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.branches).toHaveLength(101);
    });
    expect(result.current.data?.branches.at(-1)).toBe("feature/navigation");
    expect(result.current.data?.truncated).toBe(false);
    expect(requests).toMatchObject([
      { query: "feature/", pageSize: 100, branchesAfter: null, withTags: true },
      { query: "feature/", branchesAfter: "next-branch", withTags: false },
    ]);
  });

  it("caps ref paging at 500 branches and reports truncation", async () => {
    let requests = 0;
    server.use(
      github.query("RepositoryRefs", () => {
        requests++;
        return HttpResponse.json({
          data: {
            repository: {
              defaultBranchRef: { name: "main" },
              branches: {
                nodes: Array.from({ length: 100 }, (_, index) => ({
                  name: `branch-${String(requests)}-${String(index)}`,
                })),
                pageInfo: { hasNextPage: true, endCursor: String(requests) },
              },
              tags: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        });
      }),
    );
    const { result } = renderHook(() => useRefs(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.data?.branches).toHaveLength(500);
    });
    expect(result.current.data?.branches[0]).toBe("main");
    expect(result.current.data?.truncated).toBe(true);
    expect(requests).toBe(5);
  });

  it("resolves a longer slash ref beyond the paging cap", async () => {
    const requests: unknown[] = [];
    server.use(
      github.query("RepositoryRefs", ({ variables }) =>
        HttpResponse.json({
          data: {
            repository: {
              defaultBranchRef: null,
              branches: {
                nodes: variables.branchesAfter ? [] : [{ name: "feature/login" }],
                pageInfo: {
                  hasNextPage: true,
                  endCursor: `${String(variables.branchesAfter ?? "")}:next`,
                },
              },
              tags: {
                nodes: [{ name: "feature/login/mobile" }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
      ),
      github.query("ResolveRepositoryRef", ({ variables }) => {
        requests.push(variables);
        const branch =
          variables.branch === "refs/heads/feature/login/mobile"
            ? { name: "feature/login/mobile", prefix: "refs/heads/" }
            : null;
        return HttpResponse.json({ data: { repository: { branch, tag: null } } });
      }),
    );
    const { result } = renderHook(
      () => useResolvedRefPath(OWNER, REPO, "feature", "login/mobile/src/app.ts", "blob", true),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.resolvedPath).toEqual({
        ref: "refs/heads/feature/login/mobile",
        path: "src/app.ts",
      });
    });
    expect(requests).toMatchObject([
      { branch: "refs/heads/feature/login/mobile/src", tag: "refs/tags/feature/login/mobile/src" },
      { branch: "refs/heads/feature/login/mobile", tag: "refs/tags/feature/login/mobile" },
    ]);
  });

  it("resolves an exact branch from a short URL with a same-named tag", async () => {
    const repository = refsFixture.data.repository;
    server.use(
      github.query("RepositoryRefs", () =>
        HttpResponse.json({
          data: {
            repository: {
              ...repository,
              tags: { ...repository.tags, nodes: [{ name: "main" }] },
            },
          },
        }),
      ),
    );
    const { result } = renderHook(
      () => useResolvedRefPath(OWNER, REPO, "main", "src/hello.ts", "blob", true),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.resolvedPath).toEqual({ ref: "refs/heads/main", path: "src/hello.ts" });
    });
  });

  it.each([
    { shortRef: "main", prefix: "", qualifiedRef: "refs/heads/main", savedResolution: null },
    {
      shortRef: "v1.0.0",
      prefix: "",
      qualifiedRef: "refs/tags/v1.0.0",
      savedResolution: undefined,
    },
    {
      shortRef: "feature",
      prefix: "navigation/",
      qualifiedRef: "refs/heads/feature/navigation",
      savedResolution: undefined,
    },
  ])(
    "reopens a file cached under $qualifiedRef via a short link offline",
    async ({ shortRef, prefix, qualifiedRef, savedResolution }) => {
      const path = "src/hello.ts";
      const shortPath = prefix + path;
      server.use(github.query("RepositoryFile", () => HttpResponse.json(fileFixture)));
      const opened = renderHook(() => useFile(OWNER, REPO, qualifiedRef, path), { wrapper });
      await waitFor(() => {
        expect(opened.result.current.data).toMatchObject({
          kind: "text",
          text: "export const hello = true;",
        });
      });
      opened.unmount();

      client.setQueryData(
        [310, "refPath", OWNER, REPO, shortRef, shortPath, "blob"],
        savedResolution,
      );
      const saved = dehydrate(client);
      client.clear();
      client = new QueryClient();
      hydrate(client, saved);
      onlineManager.setOnline(false);
      const { result } = renderHook(
        () => {
          const resolution = useResolvedRefPath(OWNER, REPO, shortRef, shortPath, "blob", true);
          const target = resolution.resolvedPath ?? { ref: shortRef, path: shortPath };
          return useFile(OWNER, REPO, target.ref, target.path);
        },
        { wrapper },
      );

      expect(result.current.data).toMatchObject({
        kind: "text",
        text: "export const hello = true;",
      });
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: [310, "file", OWNER, REPO] })
          .map(({ queryKey }) => queryKey),
      ).toEqual([[310, "file", OWNER, REPO, qualifiedRef, path]]);
    },
  );

  it("sorts directories first and preserves symlinks and submodules", async () => {
    let expression: unknown;
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>(
        "RepositoryTree",
        ({ variables }) => {
          expression = variables.expression;
          return HttpResponse.json(treeFixture);
        },
      ),
    );
    const { result } = renderHook(() => useTree(OWNER, REPO, "feature/navigation", "src"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(expression).toBe("feature/navigation:src");
    expect(result.current.data).toEqual([
      { name: "assets", path: "src/assets", type: "dir", size: null },
      { name: "alpha.ts", path: "src/alpha.ts", type: "file", size: 30 },
      { name: "README-link", path: "src/README-link", type: "symlink", size: 12 },
      { name: "vendor", path: "src/vendor", type: "submodule", size: 0 },
      { name: "zebra.ts", path: "src/zebra.ts", type: "file", size: 20 },
    ]);
  });

  it("loads the actual README path and rendered HTML at the selected ref", async () => {
    const seen: string[] = [];
    let notifyHtmlRequest: (() => void) | undefined;
    const htmlRequested = new Promise<void>((resolve) => {
      notifyHtmlRequest = resolve;
    });
    server.use(
      http.get(`${API}/repos/${OWNER}/${REPO}/readme`, async ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("ref") ?? "");
        if (request.headers.get("Accept") === "application/vnd.github.html+json") {
          notifyHtmlRequest?.();
          return HttpResponse.text("<h1>Hello Mobile</h1>", {
            headers: { "Content-Type": "application/vnd.github.html+json; charset=utf-8" },
          });
        }
        await htmlRequested;
        return HttpResponse.json(readmeFixture);
      }),
    );
    const { result } = renderHook(() => useReadme(OWNER, REPO, "release/v1"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({ html: "<h1>Hello Mobile</h1>", path: "docs/README.md" });
    expect(seen).toEqual(["release/v1", "release/v1"]);
  });

  it("treats a missing README as absent but exposes permission errors", async () => {
    server.use(
      http.get(`${API}/repos/${OWNER}/${REPO}/readme`, () =>
        HttpResponse.json({ message: "Not Found" }, { status: 404 }),
      ),
    );
    const missing = renderHook(() => useReadme(OWNER, REPO, null), { wrapper });
    await waitFor(() => {
      expect(missing.result.current.isSuccess).toBe(true);
    });
    expect(missing.result.current.data).toBeNull();
    server.use(
      http.get(`${API}/repos/${OWNER}/${REPO}/readme`, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );
    const denied = renderHook(() => useReadme(OWNER, REPO, "private"), { wrapper });
    await waitFor(() => {
      expect(denied.result.current.error).toMatchObject({ kind: "forbidden" });
    });
  });
});

describe("repository toggles", () => {
  it("optimistically stars and rolls back a rejected mutation", async () => {
    let rejectStar: (() => void) | undefined;
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("Repository", () =>
        HttpResponse.json(repositoryFixture),
      ),
      github.mutation<Record<string, unknown>, Record<string, unknown>>(
        "StarRepository",
        async ({ variables }) => {
          expect(variables.id).toBe("R_hello_mobile");
          await new Promise<void>((resolve) => {
            rejectStar = resolve;
          });
          const rejected = { errors: [{ type: "FORBIDDEN", message: "Star forbidden" }] };
          return HttpResponse.json(rejected);
        },
      ),
    );
    const repository = renderHook(() => useRepository(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(repository.result.current.isSuccess).toBe(true);
    });
    const star = renderHook(useStar, { wrapper });
    act(() => {
      star.result.current.mutate({ owner: OWNER, repo: REPO, star: true });
    });
    await waitFor(() => {
      expect(repository.result.current.data).toMatchObject({ stars: 43, viewerHasStarred: true });
    });
    await waitFor(() => {
      expect(rejectStar).toBeDefined();
    });
    act(() => {
      rejectStar?.();
    });
    await waitFor(() => {
      expect(star.result.current.isError).toBe(true);
    });
    expect(repository.result.current.data).toMatchObject({ stars: 42, viewerHasStarred: false });
  });

  it("watches optimistically and sends the documented subscription enum", async () => {
    let finishWatch: (() => void) | undefined;
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("Repository", () =>
        HttpResponse.json(repositoryFixture),
      ),
      github.mutation<Record<string, unknown>, Record<string, unknown>>(
        "WatchRepository",
        async ({ variables }) => {
          expect(variables).toMatchObject({ id: "R_hello_mobile", state: "SUBSCRIBED" });
          await new Promise<void>((resolve) => {
            finishWatch = resolve;
          });
          return HttpResponse.json({ data: { updateSubscription: { clientMutationId: null } } });
        },
      ),
    );
    const repository = renderHook(() => useRepository(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(repository.result.current.isSuccess).toBe(true);
    });
    const watch = renderHook(useWatch, { wrapper });
    act(() => {
      watch.result.current.mutate({ owner: OWNER, repo: REPO, subscribe: true });
    });
    await waitFor(() => {
      expect(repository.result.current.data).toMatchObject({
        watchers: 4,
        viewerSubscription: "subscribed",
      });
    });
    await waitFor(() => {
      expect(finishWatch).toBeDefined();
    });
    act(() => {
      finishWatch?.();
    });
    await waitFor(() => {
      expect(watch.result.current.isSuccess).toBe(true);
    });
  });
});

it.each(["star", "watch"] as const)("sends the removal mutation for %s", async (toggle) => {
  const fixture = structuredClone(repositoryFixture);
  fixture.data.repository.viewerHasStarred = true;
  fixture.data.repository.viewerSubscription = "SUBSCRIBED";
  let mutations = 0;
  server.use(
    github.query<Record<string, unknown>, Record<string, unknown>>("Repository", () =>
      HttpResponse.json(fixture),
    ),
    github.mutation<Record<string, unknown>, Record<string, unknown>>(
      toggle === "star" ? "UnstarRepository" : "WatchRepository",
      ({ variables }) => {
        mutations++;
        expect(variables.id).toBe("R_hello_mobile");
        if (toggle === "watch") expect(variables.state).toBe("UNSUBSCRIBED");
        return HttpResponse.json({
          data:
            toggle === "star"
              ? { removeStar: { clientMutationId: null } }
              : { updateSubscription: { clientMutationId: null } },
        });
      },
    ),
  );
  const repository = renderHook(() => useRepository(OWNER, REPO), { wrapper });
  await waitFor(() => {
    expect(repository.result.current.isSuccess).toBe(true);
  });
  const toggles = renderHook(() => ({ star: useStar(), watch: useWatch() }), { wrapper });
  await act(async () => {
    if (toggle === "star")
      await toggles.result.current.star.mutateAsync({ owner: OWNER, repo: REPO, star: false });
    else
      await toggles.result.current.watch.mutateAsync({
        owner: OWNER,
        repo: REPO,
        subscribe: false,
      });
  });
  expect(mutations).toBe(1);
});

describe("file viewer", () => {
  it.each([
    ["fixture", "one\ntwo\n", 2],
    ["line limit", "x\n".repeat(20_000), 20_000],
    ["empty", "", 0],
    ["blank line", "\n", 1],
  ])(
    "counts newline-terminated %s files without an extra line",
    async (_label, text, lineCount) => {
      const fixture = structuredClone(trailingNewlineFixture);
      Object.assign(fixture.data.repository.object, { text, byteSize: text.length });
      server.use(github.query("RepositoryFile", () => HttpResponse.json(fixture)));
      const { result } = renderHook(() => useFile(OWNER, REPO, "main", "lines.txt"), { wrapper });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toMatchObject({ kind: "text", text, lineCount });
    },
  );

  it("returns text and the branch head in one GraphQL request", async () => {
    let requests = 0;
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>(
        "RepositoryFile",
        ({ variables }) => {
          requests++;
          expect(variables).toMatchObject({
            ref: "feature/navigation",
            expression: "feature/navigation:src/hello.ts",
            branchRef: "refs/heads/feature/navigation",
          });
          return HttpResponse.json(fileFixture);
        },
      ),
    );
    const { result } = renderHook(
      () => useFile(OWNER, REPO, "feature/navigation", "src/hello.ts"),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({
      kind: "text",
      text: "export const hello = true;",
      size: 26,
      lineCount: 1,
      blobSha: "abcdef0123456789abcdef0123456789abcdef01",
      headOid: "0123456789abcdef0123456789abcdef01234567",
      onBranch: true,
      language: "typescript",
    });
    expect(requests).toBe(1);
  });

  it.each(["v1.0.0", fileFixture.data.repository.head.oid])(
    "treats %s as read-only without a branch",
    async (ref) => {
      const fixture = fileFixture.data.repository;
      server.use(
        github.query("RepositoryFile", () =>
          HttpResponse.json({ data: { repository: { ...fixture, branch: null } } }),
        ),
      );
      const { result } = renderHook(() => useFile(OWNER, REPO, ref, "src/hello.ts"), { wrapper });
      await waitFor(() => {
        expect(result.current.data).toMatchObject({ kind: "text", onBranch: false });
      });
    },
  );

  it("reads a qualified tag and keeps it read-only if a branch shares its name", async () => {
    const tag = "refs/tags/main";
    server.use(
      github.query("RepositoryFile", ({ variables }) => {
        expect(variables).toMatchObject({
          ref: tag,
          expression: `${tag}:src/hello.ts`,
          branchRef: tag,
        });
        return HttpResponse.json(fileFixture);
      }),
    );
    const { result } = renderHook(() => useFile(OWNER, REPO, tag, "src/hello.ts"), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toMatchObject({ kind: "text", onBranch: false });
    });
  });

  it("fetches rendered Markdown using the HTML media type", async () => {
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("RepositoryFile", () =>
        HttpResponse.json(fileFixture),
      ),
      http.get(`${API}/repos/${OWNER}/${REPO}/contents/docs/read%20me.md`, ({ request }) => {
        expect(request.headers.get("Accept")).toBe("application/vnd.github.html+json");
        expect(new URL(request.url).searchParams.get("ref")).toBe("main");
        return HttpResponse.html("<p>Rendered</p>");
      }),
    );
    const { result } = renderHook(() => useFile(OWNER, REPO, "main", "docs/read me.md"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toMatchObject({ kind: "markdown", html: "<p>Rendered</p>" });
  });

  it.each([
    { byteSize: 1024 * 1024 + 1, text: "small" },
    { byteSize: 40_002, text: "x\n".repeat(20_000) + "x" },
  ])("returns an escape URL for oversized files ($byteSize bytes)", async ({ byteSize, text }) => {
    const fixture = structuredClone(fileFixture);
    Object.assign(fixture.data.repository.object, { byteSize, text });
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("RepositoryFile", () =>
        HttpResponse.json(fixture),
      ),
    );
    const { result } = renderHook(() => useFile(OWNER, REPO, "feature/a", "large.txt"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual({
      kind: "tooLarge",
      size: byteSize,
      rawUrl: `https://raw.githubusercontent.com/${OWNER}/${REPO}/feature%2Fa/large.txt`,
    });
  });

  it("keeps non-image binary content as metadata", async () => {
    const fixture = structuredClone(fileFixture);
    Object.assign(fixture.data.repository.object, { isBinary: true, text: null });
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("RepositoryFile", () =>
        HttpResponse.json(fixture),
      ),
    );
    const { result } = renderHook(() => useFile(OWNER, REPO, "main", "archive.zip"), { wrapper });
    await waitFor(() => {
      expect(result.current.data).toEqual({ kind: "binary", size: 26 });
    });
  });

  it("uses unauthenticated raw URLs for public images", async () => {
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("RepositoryFile", () =>
        HttpResponse.json(fileFixture),
      ),
    );
    const { result } = renderHook(() => useFile(OWNER, REPO, "main", "assets/icon.png"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({
        kind: "image",
        size: 26,
        src: `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/assets/icon.png`,
      });
    });
  });

  it("returns private images as data URLs without a token in the URL", async () => {
    const fixture = structuredClone(fileFixture);
    fixture.data.repository.isPrivate = true;
    fixture.data.repository.object.byteSize = 68;
    let imageRequests = 0;
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>("RepositoryFile", () =>
        HttpResponse.json(fixture),
      ),
      http.get(`${API}/repos/${OWNER}/${REPO}/contents/assets/icon.png`, ({ request }) => {
        imageRequests++;
        expect(request.headers.get("Authorization")).toBe("Bearer gho_repo_fixture");
        return HttpResponse.json(imageFixture);
      }),
    );
    const expected = {
      kind: "image",
      size: 68,
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S0AAAAASUVORK5CYII=",
    };
    const { result, unmount } = renderHook(() => useFile(OWNER, REPO, "main", "assets/icon.png"), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.data).toEqual(expected);
    });
    unmount();
    const reopened = renderHook(() => useFile(OWNER, REPO, "main", "assets/icon.png"), { wrapper });
    await waitFor(() => {
      expect(reopened.result.current.data).toEqual(expected);
    });
    expect(imageRequests).toBe(1);
  });
});

describe("releases and Markdown", () => {
  it("paginates release summaries", async () => {
    const cursors: unknown[] = [];
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>(
        "RepositoryReleases",
        ({ variables }) => {
          cursors.push(variables.after);
          const fixture = structuredClone(releasesFixture);
          if (variables.after) {
            fixture.data.repository.releases.nodes = [];
            fixture.data.repository.releases.pageInfo.hasNextPage = false;
          }
          return HttpResponse.json(fixture);
        },
      ),
    );
    const { result } = renderHook(() => useReleases(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items[0]).toEqual({
      repo: { owner: OWNER, name: REPO },
      tagName: "v1.0.0",
      name: "Mobile launch",
      publishedAt: "2026-11-15T10:00:00Z",
      isPrerelease: false,
      author: { login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(cursors).toEqual([null, "release-page-2"]);
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });
  });

  it("returns release notes and downloads", async () => {
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>(
        "RepositoryReleaseDetail",
        () => HttpResponse.json(releaseFixture),
      ),
    );
    const { result } = renderHook(() => useRelease(OWNER, REPO, "v1.0.0"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toMatchObject({
      tagName: "v1.0.0",
      notesHtml: "<h2>Mobile launch</h2><p>Ready for review.</p>",
      assets: [{ name: "hello-mobile.zip", size: 1024, downloadCount: 12 }],
    });
  });

  it("collects all release assets across pages", async () => {
    const cursors: unknown[] = [];
    server.use(
      github.query<Record<string, unknown>, Record<string, unknown>>(
        "RepositoryReleaseDetail",
        ({ variables }) => {
          cursors.push(variables.after);
          const release = releaseFixture.data.repository.release;
          return HttpResponse.json({
            data: {
              repository: {
                release: {
                  ...release,
                  releaseAssets: {
                    nodes: [
                      {
                        ...release.releaseAssets.nodes[0],
                        name: variables.after ? "second.zip" : "first.zip",
                      },
                    ],
                    pageInfo: {
                      hasNextPage: !variables.after,
                      endCursor: variables.after ? null : "assets-2",
                    },
                  },
                },
              },
            },
          });
        },
      ),
    );
    const { result } = renderHook(() => useRelease(OWNER, REPO, "v1.0.0"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.assets.map((asset) => asset.name)).toEqual([
      "first.zip",
      "second.zip",
    ]);
    expect(cursors).toEqual([null, "assets-2"]);
  });

  it("does not retry a rejected Markdown render", async () => {
    let requests = 0;
    server.use(
      http.post(`${API}/markdown`, () => {
        requests++;
        return HttpResponse.json({ message: "Unavailable" }, { status: 500 });
      }),
    );
    const { result } = renderHook(useRenderMarkdown, { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ text: "Hello" })).rejects.toMatchObject({
        kind: "server",
        status: 500,
      });
    });
    expect(requests).toBe(1);
  });

  it("renders GFM in repository context", async () => {
    let requests = 0;
    server.use(
      http.post(`${API}/markdown`, async ({ request }) => {
        requests++;
        expect(request.headers.get("Accept")).toBe("application/vnd.github+json");
        expect(await request.json()).toEqual({
          text: "See #42",
          mode: "gfm",
          context: `${OWNER}/${REPO}`,
        });
        return HttpResponse.html("<p>See <a>#42</a></p>");
      }),
    );
    const { result } = renderHook(useRenderMarkdown, { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ text: "See #42", repo: { owner: OWNER, name: REPO } }),
      ).resolves.toBe("<p>See <a>#42</a></p>");
    });
    expect(requests).toBe(1);
  });
});

it("uses Shiki IDs and commit-pinned encoded permalinks", () => {
  expect(languageForPath("src/Hello.TSX")).toBe("tsx");
  expect(languageForPath("Dockerfile")).toBe("dockerfile");
  expect(languageForPath("Makefile")).toBe("makefile");
  expect(languageForPath("unknown.xyz")).toBeNull();
  expect(permalink(OWNER, REPO, "abc123", "a b/hello#.ts", { start: 2, end: 5 })).toBe(
    `https://github.com/${OWNER}/${REPO}/blob/abc123/a%20b/hello%23.ts#L2-L5`,
  );
  expect(permalink(OWNER, REPO, "abc123", "index.ts", { start: 3, end: 3 })).toContain("#L3");
});
