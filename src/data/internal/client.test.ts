import "fake-indexeddb/auto";
import { graphql as gql } from "gql.tada";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { apiPath, graphql, nextPageUrl, rest } from "./client";
import { isGitHubError } from "../errors";
import { lowestRateLimit, rateLimitBlockedUntil, secondaryBackoffMs } from "./rate-limit";
import { installBrowserDoubles, persistedText } from "./test-doubles";
import { subscribeSessionEvents, type SessionEvent } from "./tokens";

const API = "https://api.github.com";
let tokenCount = 0;

const server = setupServer(
  http.post("/auth/token", () => {
    tokenCount++;
    return HttpResponse.json({
      accessToken: `gho_client_${String(tokenCount)}`,
      expiresAt: Date.now() + 3_600_000,
    });
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
});
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});

describe("rest", () => {
  it("sends exactly the GitHub headers and encodes query values", async () => {
    const seen: Request[] = [];
    server.use(
      http.get(`${API}/repos/o/r/issues`, ({ request }) => {
        seen.push(request);
        return HttpResponse.json([{ number: 1 }]);
      }),
    );
    const response = await rest<{ number: number }[]>(1, {
      path: apiPath`/repos/${"o"}/${"r"}/issues`,
      query: { state: "open", per_page: 50, labels: undefined },
    });
    expect(response.body).toEqual([{ number: 1 }]);
    const request = seen[0];
    expect(request?.headers.get("Authorization")).toMatch(/^Bearer gho_client_\d+$/);
    expect(request?.headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
    expect(request?.headers.get("Accept")).toBe("application/vnd.github+json");
    expect(new URL(request?.url ?? "").search).toBe("?state=open&per_page=50");
  });

  it("reuses the stored body when GitHub answers 304", async () => {
    const conditions: (string | null)[] = [];
    server.use(
      http.get(`${API}/notifications`, ({ request }) => {
        conditions.push(
          request.headers.get("If-None-Match"),
          request.headers.get("If-Modified-Since"),
        );
        if (request.headers.get("If-None-Match") === '"v1"')
          return new HttpResponse(null, { status: 304 });
        return HttpResponse.json([{ id: "1" }], {
          headers: { ETag: '"v1"', "Last-Modified": "Tue, 17 Nov 2026 10:00:00 GMT" },
        });
      }),
    );
    const first = await rest<unknown>(2, { path: "/notifications", revalidate: true });
    const second = await rest<unknown>(2, { path: "/notifications", revalidate: true });
    expect(first.notModified).toBe(false);
    expect(second).toMatchObject({ status: 304, notModified: true, body: [{ id: "1" }] });
    expect(conditions).toEqual([null, null, '"v1"', "Tue, 17 Nov 2026 10:00:00 GMT"]);
  });

  it("records rate-limit headers per account", async () => {
    server.use(
      http.get(`${API}/user`, () =>
        HttpResponse.json(
          {},
          {
            headers: {
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "400",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600),
              "x-ratelimit-resource": "core",
            },
          },
        ),
      ),
    );
    await rest(3, { path: "/user" });
    expect(lowestRateLimit(3)).toMatchObject({ limit: 5000, remaining: 400 });
    expect(lowestRateLimit(4)).toBeNull();
  });

  it("throws secondary limits at once, honoring retry-after, for reads and writes", async () => {
    let calls = 0;
    const limited = () => {
      calls++;
      return HttpResponse.json(
        { message: "You have exceeded a secondary rate limit" },
        { status: 403, headers: { "retry-after": "30" } },
      );
    };
    server.use(
      http.get(`${API}/user/repos`, limited),
      http.post(`${API}/repos/o/r/issues`, limited),
    );
    const before = Date.now();
    const failure: unknown = await rest(5, { path: "/user/repos" }).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ kind: "rateLimited", secondary: true });
    const resetAt =
      isGitHubError(failure) && failure.kind === "rateLimited" ? failure.resetAt : null;
    expect(resetAt?.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    await expect(
      rest(5, { path: "/repos/o/r/issues", method: "POST", body: { title: "x" } }),
    ).rejects.toMatchObject({ kind: "rateLimited", secondary: true });
    expect(calls).toBe(2);
    expect(rateLimitBlockedUntil(5)?.getTime()).toBeGreaterThanOrEqual(before + 30_000);
  });

  it("backs off from 60 s, doubling across consecutive secondary limits", async () => {
    let limitedNow = true;
    server.use(
      http.get(`${API}/search/issues`, () =>
        limitedNow
          ? HttpResponse.json({ message: "secondary rate limit" }, { status: 403 })
          : HttpResponse.json({ items: [] }),
      ),
    );
    const waits: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = Date.now();
      const failure: unknown = await rest(6, { path: "/search/issues" }).catch(
        (error: unknown) => error,
      );
      if (!isGitHubError(failure) || failure.kind !== "rateLimited") throw new Error("not limited");
      waits.push(Math.round((failure.resetAt.getTime() - before) / 60_000));
    }
    expect(waits).toEqual([1, 2, 4]);
    limitedNow = false;
    await rest(6, { path: "/search/issues" });
    limitedNow = true;
    const failure: unknown = await rest(6, { path: "/search/issues" }).catch(
      (error: unknown) => error,
    );
    expect(isGitHubError(failure) && failure.kind === "rateLimited" && failure.secondary).toBe(
      true,
    );
    expect(secondaryBackoffMs(6)).toBe(120_000);
  });

  it("maps a malformed JSON body to a server error", async () => {
    server.use(
      http.get(
        `${API}/user`,
        () => new HttpResponse("{not json", { headers: { "Content-Type": "application/json" } }),
      ),
    );
    await expect(rest(13, { path: "/user" })).rejects.toMatchObject({
      kind: "server",
      status: 200,
    });
  });

  it("refreshes once on 401 and retries the request", async () => {
    const authorizations: (string | null)[] = [];
    server.use(
      http.get(`${API}/user`, ({ request }) => {
        authorizations.push(request.headers.get("Authorization"));
        return authorizations.length === 1
          ? HttpResponse.json({ message: "Bad credentials" }, { status: 401 })
          : HttpResponse.json({ login: "octocat" });
      }),
    );
    await expect(rest(7, { path: "/user" })).resolves.toMatchObject({ body: { login: "octocat" } });
    expect(authorizations).toHaveLength(2);
    expect(authorizations[0]).not.toBe(authorizations[1]);
  });

  it("signs the account out after a second 401", async () => {
    const events: SessionEvent[] = [];
    const unsubscribe = subscribeSessionEvents((event) => events.push(event));
    let calls = 0;
    server.use(
      http.get(`${API}/user`, () => {
        calls++;
        return HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
      }),
    );
    await expect(rest(8, { path: "/user" })).rejects.toMatchObject({ kind: "authExpired" });
    await expect(rest(8, { path: "/user" })).rejects.toMatchObject({ kind: "authExpired" });
    unsubscribe();
    expect(calls).toBe(2);
    expect(events).toEqual([{ type: "signedOut", accountId: 8, reason: "rejected" }]);
    expect(await persistedText()).not.toContain("gho_client");
  });

  it("maps fetch failures to network errors", async () => {
    server.use(http.get(`${API}/user`, () => HttpResponse.error()));
    await expect(rest(9, { path: "/user" })).rejects.toMatchObject({ kind: "network" });
  });

  it("refuses requests outside api.github.com with a GitHubError", async () => {
    await expect(rest(10, { path: "//evil.example/steal" })).rejects.toMatchObject({
      kind: "notFound",
    });
    await expect(rest(10, { path: "https://api.github.com.evil.example/" })).rejects.toMatchObject({
      kind: "notFound",
    });
  });
});

describe("graphql", () => {
  const viewerQuery = gql(`
    query Viewer($first: Int!) {
      viewer { login repositories(first: $first) { totalCount } }
      rateLimit { limit remaining resetAt }
    }
  `);

  it("sends the printed document and returns typed data", async () => {
    let body: unknown = null;
    const resetAt = new Date(Date.now() + 600_000).toISOString();
    server.use(
      http.post(`${API}/graphql`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: {
            viewer: { login: "octocat", repositories: { totalCount: 3 } },
            rateLimit: { limit: 5000, remaining: 100, resetAt },
          },
        });
      }),
    );
    const viewer = await graphql(11, viewerQuery, { first: 5 });
    expect(viewer.viewer.login).toBe("octocat");
    expect(body).toMatchObject({ variables: { first: 5 } });
    expect(JSON.stringify(body)).toContain("query Viewer($first: Int!)");
    expect(lowestRateLimit(11)).toMatchObject({ remaining: 100, limit: 5000 });
  });

  it("throws mapped GraphQL errors", async () => {
    server.use(
      http.post(`${API}/graphql`, () =>
        HttpResponse.json({
          data: null,
          errors: [{ type: "NOT_FOUND", message: "Could not resolve" }],
        }),
      ),
    );
    await expect(graphql(12, viewerQuery, { first: 1 })).rejects.toMatchObject({
      kind: "notFound",
    });
  });
});

describe("paths", () => {
  it("encodes segments and rejects dot segments", () => {
    expect(apiPath`/repos/${"a b"}/${"c#d"}/issues/${7}`).toBe("/repos/a%20b/c%23d/issues/7");
    expect(() => apiPath`/repos/${".."}/x`).toThrow(expect.objectContaining({ kind: "notFound" }));
    expect(() => apiPath`/repos/${""}/x`).toThrow(expect.objectContaining({ kind: "notFound" }));
  });

  it("reads the next page link", () => {
    const headers = new Headers({
      link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
    });
    expect(nextPageUrl(headers)).toBe("https://api.github.com/x?page=2");
    expect(nextPageUrl(new Headers())).toBeNull();
  });
});
