import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "../internal/test-doubles";
import { property } from "../internal/json";
import { useActivityFeed, useStarredReleases, useViewerSummary } from ".";
import viewer from "./fixtures/viewer.json";
import releases from "./fixtures/releases.json";
import events from "./fixtures/events.json";
vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 101, login: "mona" }) }));
const server = setupServer(
  http.post("/auth/token", () => HttpResponse.json({ accessToken: "gho_test", expiresAt: null })),
);
const clients: QueryClient[] = [];
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeAll(() => {
  installBrowserDoubles();
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => {
    client.clear();
  });
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});
describe("home queries", () => {
  it("maps profile totals and contribution levels with one request", async () => {
    let requests = 0;
    server.use(
      http.post("https://api.github.com/graphql", () => {
        requests++;
        return HttpResponse.json({ data: viewer });
      }),
    );
    const { result } = renderHook(useViewerSummary, { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toMatchObject({
      login: "mona",
      followers: 12,
      following: 7,
      contributions: {
        total: 42,
        weeks: [
          [
            { date: "2026-11-16", count: 4, level: 2 },
            { date: "2026-11-17", count: 0, level: 0 },
          ],
        ],
      },
    });
    expect(requests).toBe(1);
  });
  it("filters old starred releases in one bounded GraphQL request", async () => {
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    let requests = 0;
    server.use(
      http.post("https://api.github.com/graphql", async ({ request }) => {
        requests++;
        const body: unknown = await request.json();
        expect(property(body, "query")).toMatch(/releases\(\s*first:\s*\$releasesPerRepository\b/);
        expect(property(body, "variables")).toEqual({ releasesPerRepository: 10 });
        return HttpResponse.json({ data: releases });
      }),
    );
    const { result } = renderHook(useStarredReleases, { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((release) => release.tagName)).toEqual(["v1.0.0"]);
    expect(requests).toBe(1);
  });
  it("keeps every release a busy repository published inside the window", async () => {
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    const published = ["2026-11-16", "2026-11-08", "2026-11-12", "2026-11-10", "2026-11-14"];
    server.use(
      http.post("https://api.github.com/graphql", () =>
        HttpResponse.json({
          data: {
            viewer: {
              starredRepositories: {
                nodes: [
                  {
                    name: "busy",
                    owner: { login: "octo-org" },
                    releases: {
                      nodes: published.map((day, index) => ({
                        tagName: `v${String(5 - index)}`,
                        name: null,
                        publishedAt: `${day}T12:00:00.000Z`,
                        isDraft: false,
                        isPrerelease: false,
                        author: null,
                      })),
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const { result } = renderHook(useStarredReleases, { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((release) => release.tagName)).toEqual([
      "v5",
      "v1",
      "v3",
      "v2",
      "v4",
    ]);
  });
  it("includes the fourteen-day boundary and excludes older releases", async () => {
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    server.use(
      http.post("https://api.github.com/graphql", () =>
        HttpResponse.json({
          data: {
            viewer: {
              starredRepositories: {
                nodes: [
                  {
                    name: "hello-mobile",
                    owner: { login: "octo-org" },
                    releases: {
                      nodes: [
                        {
                          tagName: "at-cutoff",
                          name: null,
                          publishedAt: "2026-11-03T12:00:00.000Z",
                          isDraft: false,
                          isPrerelease: false,
                          author: null,
                        },
                        {
                          tagName: "too-old",
                          name: null,
                          publishedAt: "2026-11-03T11:59:59.999Z",
                          isDraft: false,
                          isPrerelease: false,
                          author: null,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    const { result } = renderHook(useStarredReleases, { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((release) => release.tagName)).toEqual(["at-cutoff"]);
  });
  it("groups consecutive events and caps the feed at three pages", async () => {
    const pages: string[] = [];
    server.use(
      http.get("https://api.github.com/users/mona/received_events", ({ request }) => {
        const url = new URL(request.url);
        pages.push(url.searchParams.get("page") ?? "");
        expect(url.searchParams.get("per_page")).toBe("100");
        return HttpResponse.json(events, {
          headers: {
            link: '<https://api.github.com/users/mona/received_events?page=4>; rel="next"',
          },
        });
      }),
    );
    const { result } = renderHook(() => useActivityFeed("all"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items[0]?.events).toHaveLength(2);
    expect(result.current.data?.pages[0]?.items[1]?.events[0]?.appPath).toBe(
      "/octo-org/hello-mobile/issues/13",
    );
    await result.current.fetchNextPage();
    await result.current.fetchNextPage();
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });
    expect(pages).toEqual(["1", "2", "3"]);
  });
  it("groups consecutive activity across page boundaries", async () => {
    server.use(
      http.get("https://api.github.com/users/mona/received_events", ({ request }) => {
        const page = new URL(request.url).searchParams.get("page");
        return HttpResponse.json([{ ...events[0], id: page }], {
          headers: {
            link: '<https://api.github.com/users/mona/received_events?page=2>; rel="next"',
          },
        });
      }),
    );
    const { result } = renderHook(() => useActivityFeed("stars"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(result.current.data?.pages.flatMap((page) => page.items)).toHaveLength(1);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => {
      expect(result.current.data?.pages[0]?.items[0]?.events).toHaveLength(3);
    });
    expect(result.current.data?.pages.flatMap((page) => page.items)).toHaveLength(1);
  });
  it("keeps current pushes without inventing missing commit totals", async () => {
    server.use(
      http.get("https://api.github.com/users/mona/received_events", () =>
        HttpResponse.json([
          {
            ...events[3],
            payload: {
              repository_id: 100,
              push_id: 20,
              ref: "refs/heads/main",
              head: "abc123def4567890abc123def4567890abc123de",
              before: "def123def4567890abc123def4567890abc123de",
            },
          },
        ]),
      ),
    );
    const { result } = renderHook(() => useActivityFeed("pushes"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items[0]).toMatchObject({
      kind: "push",
      events: [{ summary: { kind: "other", type: "PushEvent" } }],
    });
  });
  it("filters the feed without including other event kinds", async () => {
    server.use(
      http.get("https://api.github.com/users/mona/received_events", () =>
        HttpResponse.json(events),
      ),
    );
    const { result } = renderHook(() => useActivityFeed("issuesAndPrs"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items.map((group) => group.kind)).toEqual(["issue"]);
  });
});
