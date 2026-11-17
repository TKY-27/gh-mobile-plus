import { afterEach, describe, expect, test, vi } from "vitest";
import {
  APP_ORIGIN,
  callAuth,
  CLIENT_ID,
  CookieJar,
  finishLogin,
  getRequest,
  grantResponse,
  mockGitHub,
  startLogin,
  testEnv,
  TOKEN_URL,
  USER_URL,
  userResponse,
} from "./testing";

const SHARED_SCOPES = "notifications workflow read:org read:user user:email user:follow";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /auth/login", () => {
  test("redirects to GitHub authorize with PKCE and state", async () => {
    const { response, authorize } = await startLogin("mode=add");
    expect(response.status).toBe(302);
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      "https://github.com/login/oauth/authorize",
    );
    const params = authorize.searchParams;
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("redirect_uri")).toBe(`${APP_ORIGIN}/auth/callback`);
    expect(params.get("scope")).toBe(`repo ${SHARED_SCOPES}`);
    expect(params.get("state")).toMatch(/^[\w-]{43}$/);
    expect(params.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("prompt")).toBe("select_account");
    expect(params.has("code_verifier")).toBe(false);
  });

  test("sets the encrypted short-lived oauth cookie", async () => {
    const { response, authorize } = await startLogin("mode=add");
    const [cookie = "", ...others] = response.headers.getSetCookie();
    expect(others).toEqual([]);
    expect(cookie).toMatch(/^__Host-ghm_oauth=k1\.[\w-]+\.[\w-]+; /);
    for (const attribute of ["Max-Age=600", "Path=/", "HttpOnly", "SameSite=Lax", "Secure"]) {
      expect(cookie.split("; ")).toContain(attribute);
    }
    expect(cookie).not.toContain(authorize.searchParams.get("state"));
  });

  test("requests public_repo instead of repo for public-only sign-in", async () => {
    const { authorize } = await startLogin("mode=add&public=1");
    expect(authorize.searchParams.get("scope")).toBe(`public_repo ${SHARED_SCOPES}`);
  });

  test("omits the account picker for re-authentication", async () => {
    const { authorize } = await startLogin("mode=reauth&account=7");
    expect(authorize.searchParams.has("prompt")).toBe(false);
  });

  test("uses fresh state and verifier for each attempt", async () => {
    const first = await startLogin("mode=add");
    const second = await startLogin("mode=add");
    expect(first.authorize.searchParams.get("state")).not.toBe(
      second.authorize.searchParams.get("state"),
    );
    expect(first.authorize.searchParams.get("code_challenge")).not.toBe(
      second.authorize.searchParams.get("code_challenge"),
    );
  });

  test.each([
    "mode=other",
    "mode=add&public=yes",
    "mode=reauth",
    "mode=reauth&account=0",
    "mode=reauth&account=1e3",
    "mode=add&account=-4",
  ])("rejects invalid parameters: %s", async (query) => {
    const response = await callAuth(getRequest(`/auth/login?${query}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  test.each([
    ["/owner/repo/pull/1?tab=files", "/owner/repo/pull/1?tab=files"],
    ["/%5Cevil.com", "/%5Cevil.com"],
    ["/\\evil.com", "/"],
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\tevil.com", "/"],
    ["/\t/evil.com", "/"],
    ["/\n/evil.com", "/"],
    ["/./%2F/x", "/%2F/x"],
    ["/.//evil.com", "/"],
    ["relative", "/"],
    ["", "/"],
  ])("returns to a validated same-origin path: %j", async (returnPath, expected) => {
    mockGitHub({ [TOKEN_URL]: () => grantResponse("a"), [USER_URL]: () => userResponse(1) });
    const jar = new CookieJar();
    const query = new URLSearchParams({ mode: "add", return: returnPath });
    const { authorize } = await startLogin(query.toString(), jar);
    const response = await finishLogin(authorize, jar);
    expect(response.headers.get("Location")).toBe(`${APP_ORIGIN}${expected}`);
  });

  test("defaults the return path to the root", async () => {
    mockGitHub({ [TOKEN_URL]: () => grantResponse("a"), [USER_URL]: () => userResponse(1) });
    const jar = new CookieJar();
    const { authorize } = await startLogin("mode=add", jar);
    const response = await finishLogin(authorize, jar);
    expect(response.headers.get("Location")).toBe(`${APP_ORIGIN}/`);
  });

  test("ignores GitHub origin overrides on non-local hosts", async () => {
    const env = { ...testEnv, GHM_GITHUB_OAUTH_ORIGIN: "http://127.0.0.1:8790" };
    const { authorize } = await startLogin("mode=add", new CookieJar(), env);
    expect(authorize.origin).toBe("https://github.com");
  });

  test("honors GitHub origin overrides on localhost", async () => {
    const env = { ...testEnv, GHM_GITHUB_OAUTH_ORIGIN: "http://127.0.0.1:8790" };
    const { authorize } = await startLogin(
      "mode=add",
      new CookieJar(),
      env,
      "https://localhost:8788",
    );
    expect(authorize.origin).toBe("http://127.0.0.1:8790");
    expect(authorize.searchParams.get("redirect_uri")).toBe("https://localhost:8788/auth/callback");
  });
});
