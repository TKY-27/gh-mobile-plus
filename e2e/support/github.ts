import { defineNetworkFixture } from "@msw/playwright";
import { test as base, expect, type Page, type Request, type Route } from "@playwright/test";
import { getResponse, http, HttpResponse, type RequestHandler } from "msw";
import {
  API_VERSION,
  MOCK_GITHUB_ORIGIN,
  MOCK_USERS,
  SCOPE_COOKIE,
  scopePath,
  type MockBehavior,
  type MockReport,
  type MockUserName,
  type TokenIntrospection,
} from "../mock-github/protocol.ts";
import { API_ORIGIN, defaultGitHubHandlers, githubGraphql } from "./fixtures.ts";

export { API_ORIGIN, githubGraphql, MOCK_USERS };
export type { MockUserName };

const GITHUB_JSON = "application/vnd.github+json";
const GITHUB_MEDIA_TYPE = /^application\/vnd\.github(?:\.[a-z-]+)?(?:\+json)?$/;
const BEARER = /^Bearer (\S+)$/;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_IMPLEMENTED = 501;
const CORS_EXPOSE_HEADERS = "Access-Control-Expose-Headers";
const GITHUB_CORS_HEADERS = {
  [CORS_EXPOSE_HEADERS]: [
    "ETag",
    "Link",
    "Location",
    "Retry-After",
    "X-GitHub-OTP",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
    "X-RateLimit-Used",
    "X-RateLimit-Resource",
    "X-RateLimit-Reset",
    "X-OAuth-Scopes",
    "X-Accepted-OAuth-Scopes",
    "X-Poll-Interval",
    "X-GitHub-Media-Type",
    "X-GitHub-SSO",
    "X-GitHub-Request-Id",
    "Deprecation",
    "Sunset",
  ].join(", "),
};
const IMAGE_HOSTS = [
  "avatars.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "user-images.githubusercontent.com",
  "camo.githubusercontent.com",
  "raw.githubusercontent.com",
];
const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';

export interface ApiRequest {
  method: string;
  url: string;
  outcome: "forwarded" | "unauthorized" | "rejected";
}

export interface GitHubApi {
  use: (...handlers: RequestHandler[]) => void;
  requests: readonly ApiRequest[];
}

export class MockOAuth {
  readonly scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  async #call(method: string, action = "", body?: unknown): Promise<Response> {
    const response = await fetch(`${MOCK_GITHUB_ORIGIN}${scopePath(this.scope, action)}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`Mock control ${method} ${action} failed: ${String(response.status)}`);
    }
    return response;
  }

  async configure(behavior: Partial<MockBehavior>): Promise<void> {
    await this.#call("PUT", "", behavior);
  }

  async report(): Promise<MockReport> {
    return (await (await this.#call("GET")).json()) as MockReport;
  }

  async introspect(token: string): Promise<TokenIntrospection> {
    return (await (
      await this.#call("POST", "/introspect", { token })
    ).json()) as TokenIntrospection;
  }

  async expireAccessTokens(): Promise<void> {
    await this.#call("POST", "/expire-access-tokens");
  }

  async dispose(): Promise<void> {
    await this.#call("DELETE");
  }
}

function contractProblems(method: string, url: URL, headers: Record<string, string>): string[] {
  const accept = headers.accept ?? "";
  const problems: string[] = [];
  if (!BEARER.test(headers.authorization ?? "")) problems.push("Authorization");
  if (headers["x-github-api-version"] !== API_VERSION) problems.push("X-GitHub-Api-Version");
  const isGraphql = url.pathname === "/graphql";
  if (isGraphql ? accept !== GITHUB_JSON || method !== "POST" : !GITHUB_MEDIA_TYPE.test(accept)) {
    problems.push("Accept");
  }
  return problems;
}

interface GuardState {
  oauth: MockOAuth;
  violations: string[];
  requests: ApiRequest[];
  routed: WeakSet<Request>;
  inFlight: Set<Promise<void>>;
  closed: boolean;
}

async function guardApiRequest(route: Route, state: GuardState): Promise<void> {
  const { oauth, violations, requests } = state;
  const request = route.request();
  state.routed.add(request);
  // Teardown can leave late requests in flight.
  if (state.closed) return route.abort();
  const method = request.method();
  // Preflights carry no credentials by design.
  if (method === "OPTIONS") return route.fallback();
  const url = new URL(request.url());
  const headers = request.headers();
  const label = `${method} ${url.pathname}`;
  const problems = contractProblems(method, url, headers);
  const token = BEARER.exec(headers.authorization ?? "")?.[1];
  const introspection = token === undefined ? null : await oauth.introspect(token);
  if (introspection && !introspection.issued) problems.push("token not issued by the mock");
  if (problems.length > 0) {
    violations.push(`${label}: ${problems.join(", ")}`);
    requests.push({ method, url: url.href, outcome: "rejected" });
    return route.fulfill({
      status: HTTP_BAD_REQUEST,
      headers: GITHUB_CORS_HEADERS,
      json: { message: problems.join(", ") },
    });
  }
  if (!introspection?.active) {
    requests.push({ method, url: url.href, outcome: "unauthorized" });
    return route.fulfill({
      status: HTTP_UNAUTHORIZED,
      headers: GITHUB_CORS_HEADERS,
      json: { message: "Bad credentials" },
    });
  }
  requests.push({ method, url: url.href, outcome: "forwarded" });
  return route.fallback();
}

function baseHandlers(violations: string[], apiHandlers: RequestHandler[]): RequestHandler[] {
  return [
    ...IMAGE_HOSTS.map((host) =>
      http.get(`https://${host}/*`, () =>
        HttpResponse.text(PLACEHOLDER_SVG, { headers: { "Content-Type": "image/svg+xml" } }),
      ),
    ),
    // Never let an unmocked call reach GitHub.
    http.all(`${API_ORIGIN}/*`, async ({ request }) => {
      const response = await getResponse(apiHandlers, request);
      if (response === undefined) {
        violations.push(`${request.method} ${new URL(request.url).pathname}: not mocked`);
        return HttpResponse.json(
          { message: "Not mocked" },
          { status: HTTP_NOT_IMPLEMENTED, headers: GITHUB_CORS_HEADERS },
        );
      }
      if (response.type === "error") return response;
      const headers = new Headers(response.headers);
      headers.set(CORS_EXPOSE_HEADERS, GITHUB_CORS_HEADERS[CORS_EXPOSE_HEADERS]);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  ];
}

export const test = base.extend<{
  oauth: MockOAuth;
  github: GitHubApi;
  githubHandlers: RequestHandler[];
}>({
  githubHandlers: [defaultGitHubHandlers, { option: true }],
  oauth: async ({ context }, use, testInfo) => {
    const oauth = new MockOAuth(`${testInfo.testId}-${String(testInfo.retry)}`);
    await oauth.configure({});
    await context.addCookies([{ name: SCOPE_COOKIE, value: oauth.scope, url: MOCK_GITHUB_ORIGIN }]);
    await use(oauth);
    await oauth.dispose();
  },
  github: [
    async ({ context, oauth, githubHandlers }, use) => {
      const state: GuardState = {
        oauth,
        violations: [],
        requests: [],
        routed: new WeakSet(),
        inFlight: new Set(),
        closed: false,
      };
      const { violations, requests } = state;
      const apiHandlers = [...githubHandlers];
      const network = defineNetworkFixture({
        context,
        // Dotted paths otherwise bypass MSW.
        skipAssetRequests: false,
        handlers: baseHandlers(violations, apiHandlers),
      });
      await network.enable();
      // Playwright runs the newest route first.
      await context.route(`${API_ORIGIN}/**`, async (route) => {
        const guarded = guardApiRequest(route, state);
        state.inFlight.add(guarded);
        try {
          await guarded;
        } finally {
          state.inFlight.delete(guarded);
        }
      });
      // WebKit bypasses routes after worker activation.
      context.on("response", (response) => {
        const request = response.request();
        if (request.url().startsWith(`${API_ORIGIN}/`) && !state.routed.has(request)) {
          violations.push(`${request.method()} ${request.url()}: reached the network unmocked`);
        }
      });
      await use({
        use: (...handlers) => {
          apiHandlers.unshift(...handlers);
        },
        requests,
      });
      // Finish lookups before disposing mock state.
      state.closed = true;
      await Promise.all(state.inFlight);
      await network.disable();
      expect(violations, "GitHub API contract violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function signIn(page: Page, oauth: MockOAuth, user: MockUserName = "mona") {
  await oauth.configure({ user, consent: "approve" });
  await page.addInitScript(() => {
    localStorage.setItem("ghm-onboarding", "done");
  });
  await page.goto("/auth/login?mode=add&public=0");
  await expect(page).toHaveURL("/");
  await expect(page.locator('[data-tab="account"]')).toBeVisible();
}
