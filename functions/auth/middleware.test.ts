import { afterEach, describe, expect, test, vi } from "vitest";
import {
  APP_ORIGIN,
  callAuth,
  CLIENT_SECRET,
  CookieJar,
  finishLogin,
  getRequest,
  grantResponse,
  mockGitHub,
  postRequest,
  readForm,
  signIn,
  startLogin,
  testEnv,
  TOKEN_URL,
  USER_URL,
  userResponse,
} from "./testing";

const MARKER = { "X-GHM-Request": "1" };

afterEach(() => {
  vi.restoreAllMocks();
});

function expectUncachedWithoutCors(response: Response): void {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  const corsHeaders = [...response.headers.keys()].filter((name) =>
    name.startsWith("access-control-"),
  );
  expect(corsHeaders).toEqual([]);
}

describe("auth middleware", () => {
  test.each([
    ["no Origin", MARKER],
    ["a foreign Origin", { ...MARKER, Origin: "https://evil.example" }],
    ["a different scheme", { ...MARKER, Origin: "http://ghm.example" }],
    ["the string null Origin", { ...MARKER, Origin: "null" }],
    ["no X-GHM-Request", { Origin: APP_ORIGIN }],
    ["a wrong X-GHM-Request", { Origin: APP_ORIGIN, "X-GHM-Request": "true" }],
  ])("rejects a POST with %s", async (_label, headers) => {
    const requests = mockGitHub({});
    for (const path of ["/auth/token", "/auth/logout"]) {
      const response = await callAuth(postRequest(path, { accountId: 1 }, undefined, headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
      expect(response.headers.getSetCookie()).toEqual([]);
      expectUncachedWithoutCors(response);
    }
    expect(requests).toEqual([]);
  });

  test("rejects a cross-origin preflight", async () => {
    const response = await callAuth(
      new Request(`${APP_ORIGIN}/auth/token`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
      }),
    );
    expect(response.status).toBe(403);
    expectUncachedWithoutCors(response);
  });

  test("answers 405 for unsupported methods", async () => {
    const post = await callAuth(postRequest("/auth/accounts", {}));
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET");
    expectUncachedWithoutCors(post);
    const get = await callAuth(getRequest("/auth/token"));
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
  });

  test("marks redirects and JSON responses no-store", async () => {
    const { response } = await startLogin("mode=add");
    expectUncachedWithoutCors(response);
    expectUncachedWithoutCors(await callAuth(getRequest("/auth/accounts")));
    expectUncachedWithoutCors(await callAuth(postRequest("/auth/token", { accountId: 1 })));
  });

  test.each([
    ["missing keys", { GHM_COOKIE_KEYS: undefined }],
    ["malformed keys", { GHM_COOKIE_KEYS: "{" }],
    ["a short key", { GHM_COOKIE_KEYS: JSON.stringify({ k1: btoa("short") }) }],
    ["an unknown active kid", { GHM_COOKIE_ACTIVE_KID: "k9" }],
    ["a missing client secret", { GHM_GITHUB_CLIENT_SECRET: undefined }],
    ["an unknown token mode", { GHM_TOKEN_MODE: "forever" }],
  ])("fails closed with %s", async (_label, overrides) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env: Cloudflare.Env = { ...testEnv };
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) Reflect.deleteProperty(env, name);
      else Reflect.set(env, name, value);
    }
    for (const request of [
      getRequest("/auth/login?mode=add"),
      getRequest("/auth/accounts"),
      postRequest("/auth/token", { accountId: 1 }),
    ]) {
      const response = await callAuth(request, env);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "server_misconfigured" });
      expect(response.headers.getSetCookie()).toEqual([]);
      expectUncachedWithoutCors(response);
    }
    expect(JSON.stringify(logged.mock.calls)).not.toContain(testEnv.GHM_COOKIE_KEYS);
  });
});

test("turns unexpected failures into an uncached internal error", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
    throw new TypeError("entropy unavailable");
  });
  const response = await callAuth(getRequest("/auth/login?mode=add"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "internal_error" });
  expectUncachedWithoutCors(response);
  expect(JSON.stringify(logged.mock.calls)).not.toContain("entropy unavailable");
});

describe("dev insecure cookie flag", () => {
  const devEnv = { ...testEnv, GHM_DEV_INSECURE_COOKIES: "1" };

  test.each(["http://localhost:8788", "http://127.0.0.1:8788"])(
    "uses unprefixed, non-Secure cookies on %s",
    async (origin) => {
      const { response } = await startLogin("mode=add", new CookieJar(), devEnv, origin);
      const [cookie = ""] = response.headers.getSetCookie();
      expect(cookie).toMatch(/^ghm_oauth=/);
      expect(cookie.split("; ")).not.toContain("Secure");
    },
  );

  test.each([APP_ORIGIN, "https://localhost.evil.example", "https://127.0.0.1.nip.io"])(
    "is ignored on %s",
    async (origin) => {
      const { response } = await startLogin("mode=add", new CookieJar(), devEnv, origin);
      const [cookie = ""] = response.headers.getSetCookie();
      expect(cookie).toMatch(/^__Host-ghm_oauth=/);
      expect(cookie.split("; ")).toContain("Secure");
    },
  );

  test("keeps Secure on localhost when the flag is unset", async () => {
    const { response } = await startLogin(
      "mode=add",
      new CookieJar(),
      testEnv,
      "https://localhost:8788",
    );
    expect(response.headers.getSetCookie()[0]).toMatch(/^__Host-ghm_oauth=.*; Secure$/);
  });

  test("completes a sign-in with dev cookies on localhost", async () => {
    const origin = "http://localhost:8788";
    const jar = new CookieJar();
    mockGitHub({ [TOKEN_URL]: () => grantResponse("dev"), [USER_URL]: () => userResponse(5) });
    const { authorize } = await startLogin("mode=add", jar, devEnv, origin);
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${origin}/auth/callback`);
    const response = await finishLogin(authorize, jar, devEnv, origin);
    expect(response.headers.get("Location")).toBe(`${origin}/`);
    expect(jar.names()).toEqual(["ghm_acct_5"]);
    const listing = await callAuth(getRequest("/auth/accounts", jar, origin), devEnv);
    expect(await listing.json()).toEqual([expect.objectContaining({ id: 5 })]);
  });
});

describe("secret hygiene", () => {
  test("never logs tokens, codes, verifiers or secrets", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const jar = new CookieJar();
    await signIn(1, jar);
    const exchange = mockGitHub({
      [TOKEN_URL]: () => Response.json({ error: "bad_verification_code" }),
    });
    const { authorize } = await startLogin("mode=add", jar);
    await callAuth(
      getRequest(
        `/auth/callback?code=code-value&state=${authorize.searchParams.get("state") ?? ""}`,
        jar,
      ),
    );
    const verifier = String((await readForm(exchange[0])).code_verifier);
    mockGitHub({ [TOKEN_URL]: () => new Response("down", { status: 500 }) });
    await callAuth(postRequest("/auth/token", { accountId: 1 }, jar));
    const output = JSON.stringify(logged.mock.calls);
    expect(logged).toHaveBeenCalled();
    for (const secret of ["gho_", "ghr_", "code-value", CLIENT_SECRET, verifier, "k1."]) {
      expect(output).not.toContain(secret);
    }
  });
});
