import { afterEach, describe, expect, test, vi } from "vitest";
import {
  callAuth,
  CLIENT_ID,
  CLIENT_SECRET,
  CookieJar,
  failingBody,
  getRequest,
  grantResponse,
  mockGitHub,
  postRequest,
  readForm,
  REVOKE_URL,
  signIn,
  testEnv,
  TOKEN_URL,
} from "./testing";

const DELETED_COOKIE = "__Host-ghm_acct_8=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict; Secure";

afterEach(() => {
  vi.restoreAllMocks();
});

async function signedInJar(): Promise<CookieJar> {
  const jar = new CookieJar();
  await signIn(8, jar, { suffix: "first" });
  await signIn(9, jar);
  return jar;
}

describe("POST /auth/logout", () => {
  test("refreshes, revokes the access token and deletes the cookie", async () => {
    const jar = await signedInJar();
    const requests = mockGitHub({
      [TOKEN_URL]: () => grantResponse("second"),
      [REVOKE_URL]: () => new Response(null, { status: 204 }),
    });
    const response = await callAuth(postRequest("/auth/logout", { accountId: 8 }, jar));

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
    const [refresh, revoke] = requests;
    expect(await readForm(refresh)).toEqual(
      expect.objectContaining({ grant_type: "refresh_token", refresh_token: "ghr_refresh_first" }),
    );
    expect(revoke?.headers.get("Authorization")).toBe(
      `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`,
    );
    expect(revoke?.headers.get("Accept")).toBe("application/vnd.github+json");
    expect(revoke?.headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
    expect(await revoke?.json()).toEqual({ access_token: "gho_access_second" });

    jar.store(response);
    const listing = await callAuth(getRequest("/auth/accounts", jar));
    expect(await listing.json()).toEqual([expect.objectContaining({ id: 9 })]);
  });

  test("still deletes the cookie when revocation fails", async () => {
    const jar = await signedInJar();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockGitHub({
      [TOKEN_URL]: () => grantResponse("second"),
      [REVOKE_URL]: () => Response.json({ message: "Validation Failed" }, { status: 422 }),
    });
    const response = await callAuth(postRequest("/auth/logout", { accountId: 8 }, jar));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
    expect(logged).toHaveBeenCalledWith("ghm-auth", {
      operation: "revoke",
      kind: "http_status",
      status: 422,
    });
  });

  test("still deletes the cookie when the refresh before revocation fails", async () => {
    const jar = await signedInJar();
    const requests = mockGitHub({
      [TOKEN_URL]: () => Response.json({ error: "bad_refresh_token" }),
    });
    const response = await callAuth(postRequest("/auth/logout", { accountId: 8 }, jar));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
    expect(requests).toHaveLength(1);
  });

  test.each([
    ["refresh", { [TOKEN_URL]: failingBody }],
    ["revoke", { [TOKEN_URL]: () => grantResponse("second"), [REVOKE_URL]: failingBody }],
  ])("still deletes the cookie when the %s body fails", async (operation, handlers) => {
    const jar = await signedInJar();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockGitHub(handlers);
    const response = await callAuth(postRequest("/auth/logout", { accountId: 8 }, jar));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
    expect(logged).toHaveBeenCalledWith("ghm-auth", { operation, kind: "TypeError" });
  });

  test("revokes the stored token directly in persistent mode", async () => {
    const env = { ...testEnv, GHM_TOKEN_MODE: "persistent" };
    const jar = new CookieJar();
    await signIn(8, jar, { env });
    const requests = mockGitHub({ [REVOKE_URL]: () => new Response(null, { status: 204 }) });
    const response = await callAuth(postRequest("/auth/logout", { accountId: 8 }, jar), env);
    expect(response.status).toBe(204);
    expect(requests).toHaveLength(1);
    expect(await requests[0]?.json()).toEqual({ access_token: "gho_access_8" });
  });

  test("succeeds without a cookie and without contacting GitHub", async () => {
    const requests = mockGitHub({});
    const response = await callAuth(postRequest("/auth/logout", { accountId: 8 }));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual([DELETED_COOKIE]);
    expect(requests).toEqual([]);
  });
});
