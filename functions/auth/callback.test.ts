import { afterEach, describe, expect, test, vi } from "vitest";
import { toBase64Url } from "./envelope";
import {
  APP_ORIGIN,
  callAuth,
  CLIENT_ID,
  CLIENT_SECRET,
  CookieJar,
  finishLogin,
  getRequest,
  grantResponse,
  mockGitHub,
  postRequest,
  readForm,
  REVOKE_URL,
  REFRESH_TOKEN_SECONDS,
  signIn,
  startLogin,
  testEnv,
  TOKEN_URL,
  USER_URL,
  userResponse,
} from "./testing";

const MAX_ACCOUNTS = 5;

afterEach(() => {
  vi.restoreAllMocks();
});

async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toBase64Url(new Uint8Array(digest));
}

function signInError(response: Response): string | null {
  const location = new URL(response.headers.get("Location") ?? "");
  expect(`${location.origin}${location.pathname}`).toBe(`${APP_ORIGIN}/signin`);
  return location.searchParams.get("error");
}

function expectOAuthCookieCleared(response: Response): void {
  expect(response.headers.getSetCookie()).toContainEqual(
    "__Host-ghm_oauth=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure",
  );
}

describe("GET /auth/callback", () => {
  test("exchanges the code, writes the account cookie and returns", async () => {
    const requests = mockGitHub({
      [TOKEN_URL]: () => grantResponse("a"),
      [USER_URL]: () => userResponse(42),
    });
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add&return=%2Finbox", jar);
    const response = await finishLogin(authorize, jar);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${APP_ORIGIN}/inbox`);
    expectOAuthCookieCleared(response);
    const accountCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-ghm_acct_42="));
    expect(accountCookie?.split("; ").slice(1)).toEqual([
      `Max-Age=${String(REFRESH_TOKEN_SECONDS)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Secure",
    ]);
    expect(accountCookie).not.toContain("ghr_refresh_a");

    const [exchange, user] = requests;
    expect(exchange?.headers.get("Accept")).toBe("application/json");
    expect(exchange?.headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    const form = await readForm(exchange);
    const verifier = String(form.code_verifier);
    expect(form).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: "code-value",
      code_verifier: verifier,
      redirect_uri: `${APP_ORIGIN}/auth/callback`,
    });
    expect(verifier).toMatch(/^[\w-]{43,128}$/);
    expect(await sha256Base64Url(verifier)).toBe(authorize.searchParams.get("code_challenge"));
    expect(new URL(exchange?.url ?? "").search).toBe("");

    expect(user?.headers.get("Authorization")).toBe("Bearer gho_access_a");
    expect(user?.headers.get("Accept")).toBe("application/vnd.github+json");
    expect(user?.headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
    expect(user?.headers.get("User-Agent")).toBeTruthy();
    expect(requests).toHaveLength(2);

    const listing = await callAuth(getRequest("/auth/accounts", jar));
    expect(await listing.json()).toEqual([
      {
        id: 42,
        login: "user42",
        avatarUrl: "https://avatars.githubusercontent.com/u/42",
        publicOnly: false,
      },
    ]);
  });

  test("records public-only sign-in on the account", async () => {
    const jar = new CookieJar();
    await signIn(3, jar, { query: "mode=add&public=1" });
    const listing = await callAuth(getRequest("/auth/accounts", jar));
    expect(await listing.json()).toEqual([expect.objectContaining({ id: 3, publicOnly: true })]);
  });

  test("rejects a state that differs from the cookie", async () => {
    const requests = mockGitHub({});
    const jar = new CookieJar();
    await startLogin("mode=add", jar);
    const response = await callAuth(
      getRequest(`/auth/callback?code=c&state=${"x".repeat(43)}`, jar),
    );
    expect(signInError(response)).toBe("state_mismatch");
    expectOAuthCookieCleared(response);
    expect(requests).toEqual([]);
  });

  test.each([
    ["without the oauth cookie", "code=c&state=abc", false],
    ["without a state parameter", "code=c", true],
  ])("rejects a callback %s", async (_label, query, withCookie) => {
    const requests = mockGitHub({});
    const jar = new CookieJar();
    if (withCookie) await startLogin("mode=add", jar);
    const response = await callAuth(getRequest(`/auth/callback?${query}`, jar));
    expect(signInError(response)).toBe("state_mismatch");
    expect(requests).toEqual([]);
  });

  test("cannot replay a completed callback", async () => {
    mockGitHub({ [TOKEN_URL]: () => grantResponse("a"), [USER_URL]: () => userResponse(1) });
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add", jar);
    await finishLogin(authorize, jar);
    expect(signInError(await finishLogin(authorize, jar))).toBe("state_mismatch");
  });

  test("maps denied consent to access_denied", async () => {
    const requests = mockGitHub({});
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add", jar);
    const state = authorize.searchParams.get("state") ?? "";
    const response = await callAuth(
      getRequest(`/auth/callback?error=access_denied&state=${state}`, jar),
    );
    expect(signInError(response)).toBe("access_denied");
    expectOAuthCookieCleared(response);
    expect(requests).toEqual([]);
  });

  test("verifies state before honoring access_denied", async () => {
    const jar = new CookieJar();
    await startLogin("mode=add", jar);
    const response = await callAuth(getRequest("/auth/callback?error=access_denied", jar));
    expect(signInError(response)).toBe("state_mismatch");
    expectOAuthCookieCleared(response);
  });

  test("maps a GitHub token error answered with HTTP 200 to exchange_failed", async () => {
    mockGitHub({
      [TOKEN_URL]: () =>
        Response.json({
          error: "bad_verification_code",
          error_description: "The code passed is incorrect or expired.",
        }),
    });
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add", jar);
    const response = await finishLogin(authorize, jar);
    expect(signInError(response)).toBe("exchange_failed");
    expectOAuthCookieCleared(response);
    expect(jar.names()).toEqual([]);
  });

  test.each([
    ["an HTTP error", () => new Response("down", { status: 503 })],
    ["a non-JSON body", () => new Response("<html>", { status: 200 })],
    ["a missing refresh token", () => grantResponse("a", { refresh_token: undefined })],
  ])("maps %s from the token endpoint to exchange_failed", async (_label, reply) => {
    mockGitHub({ [TOKEN_URL]: reply, [USER_URL]: () => userResponse(1) });
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add", jar);
    expect(signInError(await finishLogin(authorize, jar))).toBe("exchange_failed");
  });

  test.each([
    ["an X-GitHub-SSO header", "Forbidden", { "X-GitHub-SSO": "required; url=https://x.test" }],
    ["an OAuth App restriction message", "Org has enabled OAuth App access restrictions.", {}],
    ["a SAML message", "Resource protected by organization SAML enforcement.", {}],
  ])("maps a 403 from /user with %s to org_restricted", async (_label, message, headers) => {
    mockGitHub({
      [TOKEN_URL]: () => grantResponse("a"),
      [USER_URL]: () => Response.json({ message }, { status: 403, headers }),
    });
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add", jar);
    expect(signInError(await finishLogin(authorize, jar))).toBe("org_restricted");
    expect(jar.names()).toEqual([]);
  });

  test.each([
    ["a 401", 401],
    ["a plain 403", 403],
  ])("maps %s from /user to exchange_failed and revokes the grant", async (_label, status) => {
    const requests = mockGitHub({
      [TOKEN_URL]: () => grantResponse("a"),
      [USER_URL]: () => Response.json({ message: "Forbidden" }, { status }),
      [REVOKE_URL]: () => new Response(null, { status: 204 }),
    });
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add", jar);
    expect(signInError(await finishLogin(authorize, jar))).toBe("exchange_failed");
    const revoke = requests[2];
    expect(`${revoke?.method ?? ""} ${revoke?.url ?? ""}`).toBe(REVOKE_URL);
    expect(revoke?.headers.get("Authorization")).toBe(
      `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    );
    expect(await revoke?.json()).toEqual({ access_token: "gho_access_a" });
    expect(jar.names()).toEqual([]);
  });

  test("refuses a sixth distinct account and revokes its grant", async () => {
    const jar = new CookieJar();
    for (let id = 1; id <= MAX_ACCOUNTS; id += 1) await signIn(id, jar);
    expect(jar.names()).toHaveLength(MAX_ACCOUNTS);

    const requests = mockGitHub({
      [TOKEN_URL]: () => grantResponse("sixth"),
      [USER_URL]: () => userResponse(MAX_ACCOUNTS + 1),
      [REVOKE_URL]: () => new Response(null, { status: 204 }),
    });
    const { authorize } = await startLogin("mode=add", jar);
    const refused = await finishLogin(authorize, jar);
    expect(signInError(refused)).toBe("account_limit");
    expect(jar.names()).toHaveLength(MAX_ACCOUNTS);
    expect(await requests[2]?.json()).toEqual({ access_token: "gho_access_sixth" });
  });

  test("allows re-authenticating an existing account at the limit", async () => {
    const jar = new CookieJar();
    for (let id = 1; id <= MAX_ACCOUNTS; id += 1) await signIn(id, jar);
    const reauth = await signIn(2, jar, { query: "mode=reauth&account=2", suffix: "again" });
    expect(reauth.headers.get("Location")).toBe(`${APP_ORIGIN}/`);
    expect(jar.names()).toHaveLength(MAX_ACCOUNTS);
    expect(reauth.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^__Host-ghm_acct_2=k1\./),
    );
  });

  test("stores the access token itself in persistent mode", async () => {
    const env = { ...testEnv, GHM_TOKEN_MODE: "persistent" };
    const jar = new CookieJar();
    mockGitHub({
      [TOKEN_URL]: () =>
        Response.json({ access_token: "gho_forever", token_type: "bearer", scope: "repo" }),
      [USER_URL]: () => userResponse(9),
    });
    const { authorize } = await startLogin("mode=add", jar, env);
    const response = await finishLogin(authorize, jar, env);
    const accountCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-ghm_acct_9="));
    expect(accountCookie).toContain("; Max-Age=34560000;");

    const requests = mockGitHub({});
    const token = await callAuth(postRequest("/auth/token", { accountId: 9 }, jar), env);
    expect(await token.json()).toEqual({ accessToken: "gho_forever", expiresAt: null });
    expect(requests).toEqual([]);
  });
});
