import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { buildSchema, parse, validate } from "graphql";
import schemaSource from "../../../schema/github.graphql?raw";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { property } from "../internal/json";
import { installBrowserDoubles, persistedText } from "../internal/test-doubles";
import repositories from "./fixtures/repositories.json";
import issues from "./fixtures/issues.json";
import users from "./fixtures/users.json";
import code from "./fixtures/code.json";

const API = "https://api.github.com";
const schema = buildSchema(schemaSource, { assumeValid: true });
const requests: { query: string; variables: unknown }[] = [];
const server = setupServer(
  http.get("/auth/accounts", () =>
    HttpResponse.json([
      {
        id: 1,
        login: "mona",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
        publicOnly: false,
      },
      {
        id: 2,
        login: "hubot",
        avatarUrl: "https://avatars.githubusercontent.com/u/2",
        publicOnly: false,
      },
    ]),
  ),
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_fixture", expiresAt: Date.now() + 3_600_000 }),
  ),
  http.post(`${API}/graphql`, async ({ request }) => {
    const body: unknown = await request.json();
    const query = property(body, "query");
    const variables = property(body, "variables");
    if (typeof query !== "string") return new HttpResponse(null, { status: 400 });
    requests.push({ query, variables });
    const type = property(variables, "type");
    return HttpResponse.json(
      type === "REPOSITORY" ? repositories : type === "ISSUE" ? issues : users,
    );
  }),
);

async function setup() {
  vi.resetModules();
  const session = await import("../session");
  const search = await import("./index");
  const { useIsRestoring } = await import("@tanstack/react-query");
  function SignedIn(props: { children: ReactNode }): ReactNode {
    const { activeAccount } = session.useSession();
    const restoring = useIsRestoring();
    return activeAccount && !restoring ? props.children : null;
  }
  function Wrapper(props: { children: ReactNode }): ReactNode {
    return (
      <session.SessionProvider>
        <SignedIn>{props.children}</SignedIn>
      </session.SessionProvider>
    );
  }
  return { search, session, Wrapper };
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
  for (const { query } of requests)
    expect(validate(schema, parse(query)).map((error) => error.message)).toEqual([]);
});
afterAll(() => {
  server.close();
});

describe("search queries", () => {
  it("disables empty searches", async () => {
    const { search, Wrapper } = await setup();
    const { result } = renderHook(() => search.useSearch("repositories", "  "), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe("idle");
    });
    expect(result.current.data).toBeUndefined();
    expect(requests).toEqual([]);
  });

  it("maps and pages repository search in one request per page", async () => {
    const { search, Wrapper } = await setup();
    const { result } = renderHook(() => search.useSearch("repositories", " mobile "), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]).toEqual({
      total: 32,
      nextCursor: "search-cursor-1",
      items: [
        {
          kind: "repository",
          repo: {
            owner: "octo-org",
            name: "hello-mobile",
            description: "A mobile GitHub client fixture",
            isPrivate: false,
            isFork: false,
            stars: 128,
            language: { name: "TypeScript", color: "#3178c6" },
            updatedAt: "2026-11-16T10:30:00Z",
          },
        },
      ],
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.variables).toMatchObject({
      query: "mobile",
      type: "REPOSITORY",
      cursor: null,
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(requests.at(-1)?.variables).toMatchObject({ cursor: "search-cursor-1" });
    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2);
    });
  });

  it("maps issue and merged pull request results", async () => {
    const { search, Wrapper } = await setup();
    const { result } = renderHook(() => search.useSearch("issues", "repo:octo-org/hello-mobile"), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]).toEqual({
      total: 2,
      nextCursor: null,
      items: [
        {
          kind: "issue",
          repo: { owner: "octo-org", name: "hello-mobile" },
          number: 12,
          title: "Support offline drafts",
          isPullRequest: false,
          state: "open",
          closedReason: null,
          updatedAt: "2026-11-16T12:00:00Z",
        },
        {
          kind: "issue",
          repo: { owner: "octo-org", name: "hello-mobile" },
          number: 13,
          title: "Improve mobile navigation",
          isPullRequest: true,
          state: "merged",
          isDraft: false,
          updatedAt: "2026-11-16T12:00:00Z",
        },
      ],
    });
    expect(requests[0]?.variables).toMatchObject({ type: "ISSUE" });
  });

  it("distinguishes people and organizations", async () => {
    const { search, Wrapper } = await setup();
    const { result } = renderHook(() => search.useSearch("users", "octo"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items).toEqual([
      {
        kind: "user",
        login: "mona",
        name: "Mona Octocat",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        isOrganization: false,
      },
      {
        kind: "user",
        login: "octo-org",
        name: "Octo Organization",
        avatarUrl: "https://avatars.githubusercontent.com/u/3?v=4",
        isOrganization: true,
      },
    ]);
    expect(requests[0]?.variables).toMatchObject({ type: "USER" });
  });

  it("saves user search results with private offline content disabled", async () => {
    localStorage.setItem("ghm-preferences", JSON.stringify({ keepPrivateOffline: false }));
    const { search, Wrapper } = await setup();
    const { result } = renderHook(
      () => ({
        users: search.useSearch("users", "octo"),
        repos: search.useSearch("repositories", "mobile"),
      }),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.users.isSuccess && result.current.repos.isSuccess).toBe(true);
    });
    await waitFor(
      async () => {
        const stored = await persistedText();
        expect(stored).toContain("Octo Organization");
        expect(stored).not.toContain("hello-mobile");
      },
      { timeout: 3000 },
    );
  });

  it("requests code snippets with text-match media and follows REST pagination", async () => {
    const pages: string[] = [];
    server.use(
      http.get(`${API}/search/code`, ({ request }) => {
        const url = new URL(request.url);
        expect(request.headers.get("Accept")).toBe("application/vnd.github.text-match+json");
        expect(url.searchParams.get("q")).toBe("mobile repo:octo-org/hello-mobile");
        pages.push(url.searchParams.get("page") ?? "1");
        return HttpResponse.json(code, {
          headers:
            pages.length === 1
              ? {
                  Link: `<${API}/search/code?q=mobile%20repo%3Aocto-org%2Fhello-mobile&per_page=30&page=2>; rel="next"`,
                }
              : {},
        });
      }),
    );
    const { search, Wrapper } = await setup();
    const { result } = renderHook(
      () => search.useSearch("code", "mobile repo:octo-org/hello-mobile"),
      { wrapper: Wrapper },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items).toEqual([
      {
        kind: "code",
        repo: { owner: "octo-org", name: "hello-mobile" },
        path: "src/index.ts",
        ref: "main",
        fragment: "export const mobile = true;",
      },
    ]);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(pages).toEqual(["1", "2"]);
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });
    expect(requests).toHaveLength(0);
  });

  it("keeps slash-containing code refs and permits missing snippets", async () => {
    server.use(
      http.get(`${API}/search/code`, () =>
        HttpResponse.json({
          total_count: 1,
          items: [
            {
              path: "src/blob/hello world.ts",
              html_url:
                "https://github.com/octo-org/hello-mobile/blob/feature/mobile/src/blob/hello%20world.ts",
              repository: { name: "hello-mobile", owner: { login: "octo-org" } },
            },
          ],
        }),
      ),
    );
    const { search, Wrapper } = await setup();
    const { result } = renderHook(() => search.useSearch("code", "mobile"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items[0]).toMatchObject({
      ref: "feature/mobile",
      path: "src/blob/hello world.ts",
      fragment: null,
    });
  });

  it("drops malformed code hits without losing valid results or pagination", async () => {
    const valid = code.items[0];
    server.use(
      http.get(`${API}/search/code`, () =>
        HttpResponse.json(
          {
            total_count: 5,
            items: [
              { ...valid, html_url: "not a URL" },
              { ...valid, html_url: `${API}/missing-blob` },
              { ...valid, html_url: "https://github.com/o/r/blob/main/%ZZ" },
              { ...valid, html_url: "https://github.com/o/r/blob//src/index.ts" },
              valid,
            ],
          },
          { headers: { Link: `<${API}/search/code?page=2>; rel="next"` } },
        ),
      ),
    );
    const { search, Wrapper } = await setup();
    const { result } = renderHook(() => search.useSearch("code", "mobile"), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]).toMatchObject({
      total: 5,
      nextCursor: `${API}/search/code?page=2`,
      items: [{ kind: "code", path: "src/index.ts", ref: "main" }],
    });
    expect(result.current.data?.pages[0]?.items).toHaveLength(1);
  });
});

describe("recent searches", () => {
  it("keeps the newest twenty deduplicated searches across restarts", async () => {
    const { search, Wrapper } = await setup();
    const first = renderHook(() => search.useRecentSearches(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(first.result.current.searches).toEqual([]);
    });
    act(() => {
      for (let index = 0; index < 22; index++)
        first.result.current.add({ scope: "repositories", query: `mobile-${String(index)}` });
      first.result.current.add({ scope: "repositories", query: " mobile-5 " });
      first.result.current.add({ scope: "code", query: "mobile-5" });
      first.result.current.add({ scope: "users", query: " " });
    });
    expect(first.result.current.searches).toHaveLength(20);
    expect(first.result.current.searches.slice(0, 3)).toEqual([
      { scope: "code", query: "mobile-5" },
      { scope: "repositories", query: "mobile-5" },
      { scope: "repositories", query: "mobile-21" },
    ]);
    first.unmount();
    const restarted = await setup();
    const second = renderHook(() => restarted.search.useRecentSearches(), {
      wrapper: restarted.Wrapper,
    });
    await waitFor(() => {
      expect(second.result.current.searches).toHaveLength(20);
    });
    expect(second.result.current.searches[0]).toEqual({ scope: "code", query: "mobile-5" });
  });

  it("isolates accounts and clears only the active account", async () => {
    const { search, session, Wrapper } = await setup();
    const { result } = renderHook(() => search.useRecentSearches(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.searches).toEqual([]);
    });
    act(() => {
      result.current.add({ scope: "users", query: "mona" });
    });
    act(() => {
      session.switchAccount(2);
    });
    await waitFor(() => {
      expect(result.current.searches).toEqual([]);
    });
    act(() => {
      result.current.add({ scope: "issues", query: "is:open" });
    });
    act(() => {
      result.current.clear();
    });
    expect(localStorage.getItem("ghm-recent-searches-2")).toBeNull();
    act(() => {
      session.switchAccount(1);
    });
    await waitFor(() => {
      expect(result.current.searches).toEqual([{ scope: "users", query: "mona" }]);
    });
  });

  it("repairs malformed storage and adopts another tab's changes", async () => {
    localStorage.setItem("ghm-recent-searches-1", "broken json");
    const { search, Wrapper } = await setup();
    const { result } = renderHook(() => search.useRecentSearches(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.searches).toEqual([]);
    });
    act(() => {
      localStorage.setItem(
        "ghm-recent-searches-1",
        JSON.stringify([
          { scope: "unknown", query: "invalid" },
          { scope: "code", query: " mobile " },
          { scope: "code", query: "mobile" },
        ]),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "ghm-recent-searches-1" }));
    });
    expect(result.current.searches).toEqual([{ scope: "code", query: "mobile" }]);
  });

  it("applies and replaces search sort qualifiers", async () => {
    const { search } = await setup();
    expect(search.withSearchSort("mobile", "bestMatch")).toBe("mobile");
    expect(search.withSearchSort("mobile", "stars")).toBe("mobile sort:stars-desc");
    expect(search.withSearchSort("mobile sort:updated-desc", "forks")).toBe(
      "mobile sort:forks-desc",
    );
    expect(search.withSearchSort("mobile sort:stars-desc", "bestMatch")).toBe("mobile");
  });
});
