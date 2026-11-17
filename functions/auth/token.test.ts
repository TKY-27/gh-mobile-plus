import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ACCESS_TOKEN_SECONDS,
  callAuth,
  CLIENT_ID,
  CLIENT_SECRET,
  CookieJar,
  failingBody,
  grantResponse,
  mockGitHub,
  postRequest,
  readForm,
  REFRESH_TOKEN_SECONDS,
  signIn,
  testEnv,
  TOKEN_URL,
} from "./testing";

const ACCOUNT_ID = 42;
const COOKIE_NAME = `__Host-ghm_acct_${String(ACCOUNT_ID)}`;
const DELETED_COOKIE = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict; Secure`;
const MILLISECONDS_PER_SECOND = 1000;

afterEach(() => {
  vi.restoreAllMocks();
});

async function signedInJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  await signIn(ACCOUNT_ID, jar, { suffix: "first" });
  return jar;
}

const tokenRequest = (jar: CookieJar) =>
  callAuth(postRequest("/auth/token", { accountId: ACCOUNT_ID }, jar));

describe("POST /auth/token", () => {
  test("refreshes with GitHub and rotates the cookie", async () => {
    const jar = await signedInJar();
    const before = jar.get(COOKIE_NAME);
    const requests = mockGitHub({ [TOKEN_URL]: () => grantResponse("second") });
    const startedAt = Date.now();
    const response = await tokenRequest(jar);

    expect(response.status).toBe(200);
    const body = await response.json<{ accessToken: string; expiresAt: number }>();
    expect(body.accessToken).toBe("gho_access_second");
    expect(body.expiresAt).toBeGreaterThanOrEqual(
      startedAt + ACCESS_TOKEN_SECONDS * MILLISECONDS_PER_SECOND,
    );
    expect(body.expiresAt).toBeLessThanOrEqual(
      Date.now() + ACCESS_TOKEN_SECONDS * MILLISECONDS_PER_SECOND,
    );
    expect(await readForm(requests[0])).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: "ghr_refresh_first",
    });

    const [rotated = ""] = response.headers.getSetCookie();
    expect(rotated.split("; ").slice(1)).toEqual([
      `Max-Age=${String(REFRESH_TOKEN_SECONDS)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Secure",
    ]);
    jar.store(response);
    expect(jar.get(COOKIE_NAME)).not.toBe(before);

    const next = mockGitHub({ [TOKEN_URL]: () => grantResponse("third") });
    await tokenRequest(jar);
    expect(await readForm(next[0])).toEqual(
      expect.objectContaining({ refresh_token: "ghr_refresh_second" }),
    );
  });

  test("deletes the cookie and asks for re-auth on bad_refresh_token", async () => {
    const jar = await signedInJar();
    mockGitHub({
      [TOKEN_URL]: () =>
        Response.json({ error: "bad_refresh_token", error_description: "expired" }),
    });
    const response = await tokenRequest(jar);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "reauth_required" });
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
  });

  test.each([
    ["an HTTP error", () => new Response("unavailable", { status: 503 })],
    ["a different OAuth error", () => Response.json({ error: "incorrect_client_credentials" })],
    [
      "a network failure",
      (): Response => {
        throw new TypeError("Network connection lost");
      },
    ],
    ["a body that fails after headers", failingBody],
    ["missing expiry fields", () => grantResponse("x", { expires_in: undefined })],
  ])("keeps the cookie and reports upstream_failed on %s", async (_label, reply) => {
    const jar = await signedInJar();
    mockGitHub({ [TOKEN_URL]: reply });
    const response = await tokenRequest(jar);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_failed" });
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  test.each([
    ["is missing", (jar: CookieJar) => jar],
    ["fails to decrypt", (jar: CookieJar) => jar.set(COOKIE_NAME, "k1.AAAAAAAAAAAAAAAA.AAAA")],
  ])("asks for re-auth when the cookie %s", async (_label, prepare) => {
    const requests = mockGitHub({});
    const response = await tokenRequest(prepare(new CookieJar()));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "reauth_required" });
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
    expect(requests).toEqual([]);
  });

  test("asks for re-auth when the cookie was written in another token mode", async () => {
    const env = { ...testEnv, GHM_TOKEN_MODE: "persistent" };
    const jar = await signedInJar();
    const response = await callAuth(
      postRequest("/auth/token", { accountId: ACCOUNT_ID }, jar),
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
  });

  test("rejects a cookie moved to another account name", async () => {
    const jar = await signedInJar();
    const moved = new CookieJar().set("__Host-ghm_acct_7", jar.get(COOKIE_NAME) ?? "");
    const response = await callAuth(postRequest("/auth/token", { accountId: 7 }, moved));
    expect(response.status).toBe(401);
  });

  test.each([
    ["a string id", { accountId: "42" }],
    ["a fractional id", { accountId: 4.2 }],
    ["a zero id", { accountId: 0 }],
    ["extra fields", { accountId: 42, refreshToken: "x" }],
    ["an array", [42]],
    ["null", null],
  ])("rejects a body with %s", async (_label, body) => {
    const response = await callAuth(postRequest("/auth/token", body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  test("rejects a body that is not JSON", async () => {
    const request = new Request<unknown, IncomingRequestCfProperties>(
      postRequest("/auth/token", null),
      {
        body: "accountId=1",
      },
    );
    const response = await callAuth(request);
    expect(response.status).toBe(400);
  });
});
