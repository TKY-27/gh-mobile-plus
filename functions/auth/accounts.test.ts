import { afterEach, describe, expect, test, vi } from "vitest";
import { callAuth, CLIENT_ID, CookieJar, getRequest, signIn } from "./testing";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /auth/accounts", () => {
  test("lists decryptable accounts sorted by id without tokens", async () => {
    const jar = new CookieJar();
    await signIn(30, jar);
    await signIn(4, jar, { query: "mode=add&public=1" });
    jar.set("__Host-ghm_acct_5", "k1.AAAAAAAAAAAAAAAA.AAAA");
    jar.set("__Host-ghm_acct_abc", "ignored");

    const response = await callAuth(getRequest("/auth/accounts", jar));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-GHM-Client-Id")).toBe(CLIENT_ID);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual([
      {
        id: 4,
        login: "user4",
        avatarUrl: "https://avatars.githubusercontent.com/u/4",
        publicOnly: true,
      },
      {
        id: 30,
        login: "user30",
        avatarUrl: "https://avatars.githubusercontent.com/u/30",
        publicOnly: false,
      },
    ]);
    expect(text).not.toMatch(/gho_|ghr_|token/i);
  });

  test("returns an empty list without cookies", async () => {
    const response = await callAuth(getRequest("/auth/accounts"));
    expect(await response.json()).toEqual([]);
    expect(response.headers.get("X-GHM-Client-Id")).toBe(CLIENT_ID);
  });
});
