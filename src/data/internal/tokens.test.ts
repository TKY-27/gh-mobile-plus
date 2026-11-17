import "fake-indexeddb/auto";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isGitHubError } from "../errors";
import { property } from "./json";
import { databaseNames, installBrowserDoubles, persistedText } from "./test-doubles";

const HOUR_MS = 3_600_000;
let tokenCalls: number[] = [];
let logoutCalls: number[] = [];
let tokenLifetimeMs = 8 * HOUR_MS;
let tokenResponse: "ok" | "reauth" | "slow" = "ok";

async function accountIdOf(request: Request): Promise<number> {
  const accountId = property(await request.json(), "accountId");
  if (typeof accountId !== "number") throw new Error("accountId missing");
  return accountId;
}

const server = setupServer(
  http.post("/auth/token", async ({ request }) => {
    expect(request.headers.get("X-GHM-Request")).toBe("1");
    expect(request.headers.get("Content-Type")).toBe("application/json");
    const accountId = await accountIdOf(request);
    tokenCalls.push(accountId);
    if (tokenResponse === "reauth") {
      return HttpResponse.json({ error: "reauth_required" }, { status: 401 });
    }
    if (tokenResponse === "slow") await delay(50);
    return HttpResponse.json({
      accessToken: `gho_secret_${String(accountId)}_${String(tokenCalls.length)}`,
      expiresAt: Date.now() + tokenLifetimeMs,
    });
  }),
  http.post("/auth/logout", async ({ request }) => {
    logoutCalls.push(await accountIdOf(request));
    return new HttpResponse(null, { status: 204 });
  }),
);

async function openTab(): Promise<typeof import("./tokens")> {
  vi.resetModules();
  return import("./tokens");
}

async function createAccountDatabases(accountId: number): Promise<void> {
  const storage = await import("./storage");
  await storage.writeEntry("cache", accountId, "client", { cached: true });
  await storage.writeEntry("drafts", accountId, "comment", "draft");
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  tokenCalls = [];
  logoutCalls = [];
  tokenLifetimeMs = 8 * HOUR_MS;
  tokenResponse = "ok";
});
afterEach(() => {
  vi.useRealTimers();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("token single flight", () => {
  it("refreshes once when two tabs need a token at the same moment", async () => {
    const [first, second] = [await openTab(), await openTab()];
    const tokens = await Promise.all([first.getAccessToken(11), second.getAccessToken(11)]);
    expect(tokenCalls).toEqual([11]);
    expect(tokens[0]).toBe(tokens[1]);
    expect(await persistedText()).not.toContain("gho_secret");
  });

  it("refreshes once when concurrent requests in one tab see a 401", async () => {
    const tab = await openTab();
    const stale = await tab.getAccessToken(12);
    const fresh = await Promise.all([
      tab.refreshAccessToken(12, stale),
      tab.refreshAccessToken(12, stale),
      tab.refreshAccessToken(12, stale),
    ]);
    expect(tokenCalls).toEqual([12, 12]);
    expect(new Set(fresh).size).toBe(1);
    expect(fresh[0]).not.toBe(stale);
  });

  it("ignores a crossed broadcast carrying an older token", async () => {
    const tab = await openTab();
    const current = await tab.getAccessToken(13);
    const peer = new BroadcastChannel("ghm-session");
    peer.postMessage({ type: "token", accountId: 13, accessToken: "older", expiresAt: Date.now() });
    peer.postMessage({ type: "token", accountId: 13 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    peer.close();
    expect(await tab.getAccessToken(13)).toBe(current);
  });
});

describe("token lifetime", () => {
  it("refreshes proactively at 80 % of the lifetime", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    tokenLifetimeMs = 1000 * 1000;
    const tab = await openTab();
    await tab.getAccessToken(21);
    await vi.advanceTimersByTimeAsync(799_000);
    expect(tokenCalls).toEqual([21]);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(tokenCalls).toEqual([21, 21]);
    });
  });

  it("refreshes on becoming visible when under 15 minutes remain", async () => {
    tokenLifetimeMs = 10 * 60_000;
    const tab = await openTab();
    await tab.getAccessToken(22);
    setVisibility("hidden");
    expect(tokenCalls).toEqual([22]);
    setVisibility("visible");
    await vi.waitFor(() => {
      expect(tokenCalls).toEqual([22, 22]);
    });
  });
});

describe("sign-out", () => {
  it("wipes both databases and signs out every tab on reauth_required", async () => {
    const [first, second] = [await openTab(), await openTab()];
    await createAccountDatabases(31);
    expect(await databaseNames()).toEqual(["ghm-cache-31", "ghm-drafts-31"]);
    const events: unknown[] = [];
    second.subscribeSessionEvents((event) => events.push(event));
    tokenResponse = "reauth";
    const failure: unknown = await first.getAccessToken(31).catch((error: unknown) => error);
    expect(isGitHubError(failure) && failure.kind).toBe("authExpired");
    expect(await databaseNames()).toEqual([]);
    await vi.waitFor(() => {
      expect(events).toEqual([{ type: "signedOut", accountId: 31, reason: "reauthRequired" }]);
    });
    tokenResponse = "ok";
    await expect(second.getAccessToken(31)).rejects.toMatchObject({ kind: "authExpired" });
    expect(tokenCalls).toEqual([31]);
  });

  it("waits for an in-flight refresh before logging out, then rejects tokens", async () => {
    const [first, second] = [await openTab(), await openTab()];
    await createAccountDatabases(32);
    tokenResponse = "slow";
    const refreshing = first.getAccessToken(32);
    const loggingOut = second.logoutAccount(32);
    await refreshing;
    await loggingOut;
    expect(tokenCalls).toEqual([32]);
    expect(logoutCalls).toEqual([32]);
    expect(await databaseNames()).toEqual([]);
    await vi.waitFor(async () => {
      await expect(first.getAccessToken(32)).rejects.toMatchObject({ kind: "authExpired" });
    });
    expect(tokenCalls).toEqual([32]);
  });

  it("wipes both databases for every sign-out reason, including a rejected token", async () => {
    const tab = await openTab();
    await createAccountDatabases(33);
    localStorage.setItem("ghm-recent-searches-33", '[{"scope":"code","query":"secret"}]');
    await tab.markAccountSignedOut(33, "rejected");
    expect(await databaseNames()).toEqual([]);
    expect(localStorage.getItem("ghm-recent-searches-33")).toBeNull();
    await expect(tab.getAccessToken(33)).rejects.toMatchObject({ kind: "authExpired" });
    tab.reopenAccount(33);
    await expect(tab.getAccessToken(33)).resolves.toContain("gho_secret_33");
  });

  it("signs out locally when the relay is unreachable and retries later", async () => {
    const tab = await openTab();
    await tab.getAccessToken(34);
    await createAccountDatabases(34);
    server.use(http.post("/auth/logout", () => HttpResponse.error()));
    await expect(tab.logoutAccount(34)).rejects.toMatchObject({ kind: "network" });
    expect(await databaseNames()).toEqual([]);
    expect(localStorage.getItem("ghm-pending-logout")).toBe("[34]");
    await expect(tab.getAccessToken(34)).rejects.toMatchObject({ kind: "authExpired" });
    server.resetHandlers();
    await tab.retryPendingLogouts();
    expect(logoutCalls).toEqual([34]);
    expect(tab.pendingLogouts()).toEqual([]);
    expect(await persistedText()).not.toContain("gho_secret");
  });
});

describe("relay responses", () => {
  it("maps a malformed token response to a server error", async () => {
    server.use(http.post("/auth/token", () => HttpResponse.json({ accessToken: 5 })));
    const tab = await openTab();
    await expect(tab.getAccessToken(41)).rejects.toMatchObject({ kind: "server", status: 200 });
  });

  it("converts expiry to the local clock when this device runs 9 h ahead", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    const skewMs = 9 * HOUR_MS;
    server.use(
      http.post("/auth/token", () => {
        tokenCalls.push(42);
        const serverNow = Date.now() - skewMs;
        return HttpResponse.json(
          { accessToken: "gho_secret_skewed", expiresAt: serverNow + 8 * HOUR_MS },
          { headers: { Date: new Date(serverNow).toUTCString() } },
        );
      }),
    );
    const tab = await openTab();
    await tab.getAccessToken(42);
    await tab.getAccessToken(42);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await tab.getAccessToken(42);
    expect(tokenCalls).toEqual([42]);
  });

  it("never schedules refreshes faster than the floor for a past expiry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    tokenLifetimeMs = -HOUR_MS;
    const tab = await openTab();
    await tab.refreshAccessToken(43, null);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(tokenCalls).toEqual([43]);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(tokenCalls).toEqual([43, 43]);
    });
  });
});
