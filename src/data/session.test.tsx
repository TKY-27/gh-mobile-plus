import "fake-indexeddb/auto";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { property } from "./internal/json";
import type { PersistenceMeta } from "./internal/query";
import { databaseNames, installBrowserDoubles, persistedText } from "./internal/test-doubles";

const OCTO = { id: 1, login: "octo", avatarUrl: "https://avatars.example/1", publicOnly: false };
const HUBOT = { id: 2, login: "hubot", avatarUrl: "https://avatars.example/2", publicOnly: true };
let serverAccounts = [OCTO, HUBOT];
let logouts: unknown[] = [];

const server = setupServer(
  http.get("/auth/accounts", () =>
    HttpResponse.json(serverAccounts, { headers: { "X-GHM-Client-Id": "Iv1.client" } }),
  ),
  http.post("/auth/logout", async ({ request }) => {
    logouts.push(await request.json());
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_session_secret", expiresAt: Date.now() + 3_600_000 }),
  ),
);

async function loadModules() {
  vi.resetModules();
  return {
    session: await import("./session"),
    storage: await import("./internal/storage"),
    preferences: await import("./preferences"),
    errors: await import("./errors"),
    query: await import("@tanstack/react-query"),
  };
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

function renderSession(modules: Modules, signedInChildren: ReactNode = null) {
  const { SessionProvider, useSession } = modules.session;
  function SignedIn(): ReactNode {
    return useSession().activeAccount ? signedInChildren : null;
  }
  return render(
    <SessionProvider>
      <SignedIn />
    </SessionProvider>,
  );
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  serverAccounts = [OCTO, HUBOT];
  logouts = [];
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("SessionProvider", () => {
  it("loads accounts, restores the active account and keeps only its id", async () => {
    localStorage.setItem("ghm-active-account", "2");
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("ready");
    });
    expect(modules.session.readSession().activeAccount?.login).toBe("hubot");
    expect(localStorage.getItem("ghm-active-account")).toBe("2");
    expect(modules.errors.orgApprovalUrl()).toBe(
      "https://github.com/settings/connections/applications/Iv1.client",
    );
  });

  it("reports signedOut when the relay has no accounts", async () => {
    serverAccounts = [];
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession()).toMatchObject({
        status: "signedOut",
        activeAccount: null,
      });
    });
  });

  it("gives each account its own QueryClient", async () => {
    const modules = await loadModules();
    const clients = new Set<unknown>();
    function Probe(): null {
      clients.add(modules.query.useQueryClient());
      return null;
    }
    renderSession(modules, <Probe />);
    await waitFor(() => {
      expect(modules.session.readSession().activeAccount?.id).toBe(1);
    });
    const before = clients.size;
    act(() => {
      modules.session.switchAccount(2);
    });
    expect(clients.size).toBe(before + 1);
    expect(localStorage.getItem("ghm-active-account")).toBe("2");
  });

  it("signs out, removes account storage and picks another account", async () => {
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().activeAccount?.id).toBe(1);
    });
    for (const accountId of [1, 2]) {
      await modules.storage.writeEntry("cache", accountId, "client", { accountId });
      await modules.storage.writeEntry("drafts", accountId, "comment", "draft");
      localStorage.setItem(`ghm-recent-searches-${String(accountId)}`, "[]");
    }
    await act(() => modules.session.signOut(1));
    expect(logouts).toEqual([{ accountId: 1 }]);
    expect(await databaseNames()).toEqual(["ghm-cache-2", "ghm-drafts-2"]);
    expect(localStorage.getItem("ghm-recent-searches-1")).toBeNull();
    expect(localStorage.getItem("ghm-recent-searches-2")).toBe("[]");
    expect(modules.session.readSession().accounts.map((account) => account.id)).toEqual([2]);
    expect(modules.session.readSession().activeAccount?.id).toBe(2);
    await modules.storage.writeEntry("drafts", 1, "late", "write after sign-out");
    expect(await databaseNames()).toEqual(["ghm-cache-2", "ghm-drafts-2"]);
  });

  it("renders from the account snapshot when offline at start", async () => {
    localStorage.setItem("ghm-accounts", JSON.stringify([OCTO]));
    localStorage.setItem("ghm-active-account", "1");
    server.use(http.get("/auth/accounts", () => HttpResponse.error()));
    const modules = await loadModules();
    const reported = vi.spyOn(globalThis, "reportError").mockImplementation(() => undefined);
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().activeAccount?.login).toBe("octo");
    });
    reported.mockRestore();
  });

  it("deletes the databases of accounts the relay no longer lists", async () => {
    localStorage.setItem("ghm-accounts", JSON.stringify([OCTO, HUBOT]));
    serverAccounts = [OCTO];
    const modules = await loadModules();
    await modules.storage.writeEntry("cache", 2, "client", {});
    renderSession(modules);
    await waitFor(async () => {
      expect(await databaseNames()).not.toContain("ghm-cache-2");
    });
    expect(modules.session.readSession().accounts.map((account) => account.login)).toEqual([
      "octo",
    ]);
  });
});

async function storedKeys(modules: Modules, accountId: number): Promise<string[]> {
  const stored = await modules.storage.readEntry("cache", accountId, "client");
  const queries = property(property(stored, "clientState"), "queries");
  if (!Array.isArray(queries)) return [];
  return queries.map((query: unknown) => JSON.stringify(property(query, "queryKey"))).sort();
}

describe("query cache persistence", () => {
  it.each(["this tab", "another tab"])(
    "filters pending writes after turning off in %s",
    async (tab) => {
      const modules = await loadModules();
      const clients: ReturnType<typeof modules.query.useQueryClient>[] = [];
      function Capture(): null {
        clients.push(modules.query.useQueryClient());
        return null;
      }
      renderSession(modules, <Capture />);
      await waitFor(() => {
        expect(clients.length).toBeGreaterThan(0);
      });
      const queryClient = clients[0];
      if (!queryClient) throw new Error("QueryClient missing");
      await queryClient.query({ queryKey: [1, "public"], queryFn: () => "public data" });
      await queryClient.query({
        queryKey: [1, "private"],
        queryFn: () => "private data",
        meta: { private: true },
      });
      await expect(
        queryClient.query({
          queryKey: [1, "failed"],
          queryFn: () => Promise.reject(new Error("boom")),
          retry: false,
        }),
      ).rejects.toThrow("boom");
      await waitFor(
        async () => {
          expect(await storedKeys(modules, 1)).toEqual(['[1,"private"]', '[1,"public"]']);
        },
        { timeout: 3000 },
      );
      await queryClient.query({ queryKey: [1, "unclassified"], queryFn: () => "repository list" });
      await queryClient.query({
        queryKey: [1, "search", "users", "octo"],
        queryFn: () => [OCTO],
        meta: { persist: "user-search" },
      });
      if (tab === "this tab") {
        act(() => {
          modules.preferences.setPreferences({ keepPrivateOffline: false });
        });
      } else {
        localStorage.setItem("ghm-preferences", JSON.stringify({ keepPrivateOffline: false }));
        expect(modules.preferences.readPreferences().keepPrivateOffline).toBe(true);
      }
      await waitFor(
        async () => {
          expect(await storedKeys(modules, 1)).toEqual(['[1,"search","users","octo"]']);
        },
        { timeout: 3000 },
      );
      expect(await persistedText()).not.toContain("gho_session_secret");
    },
  );
});

describe("sign-out robustness", () => {
  it("retries pending logouts before adopting the account list", async () => {
    localStorage.setItem("ghm-pending-logout", "[2]");
    const order: string[] = [];
    server.use(
      http.post("/auth/logout", async ({ request }) => {
        order.push(`logout ${JSON.stringify(await request.json())}`);
        serverAccounts = [OCTO];
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("/auth/accounts", () => {
        order.push("accounts");
        return HttpResponse.json(serverAccounts);
      }),
    );
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("ready");
    });
    expect(order.slice(0, 2)).toEqual(['logout {"accountId":2}', "accounts"]);
    expect(modules.session.readSession().accounts.map((account) => account.id)).toEqual([1]);
    expect(localStorage.getItem("ghm-pending-logout")).toBeNull();
  });

  it("never re-activates a pending logout while the relay still fails", async () => {
    localStorage.setItem("ghm-pending-logout", "[2]");
    server.use(http.post("/auth/logout", () => new HttpResponse(null, { status: 502 })));
    const reported = vi.spyOn(globalThis, "reportError").mockImplementation(() => undefined);
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("ready");
    });
    expect(modules.session.readSession().accounts.map((account) => account.id)).toEqual([1]);
    expect(localStorage.getItem("ghm-pending-logout")).toBe("[2]");
    reported.mockRestore();
  });

  it("signOutAll tries every account and still wipes them when one fails", async () => {
    server.use(
      http.post("/auth/logout", async ({ request }) => {
        const body = await request.json();
        logouts.push(body);
        return property(body, "accountId") === 1
          ? new HttpResponse(null, { status: 500 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("ready");
    });
    for (const accountId of [1, 2]) await modules.storage.writeEntry("drafts", accountId, "k", 1);
    await act(async () => {
      await expect(modules.session.signOutAll()).rejects.toMatchObject({ kind: "server" });
    });
    expect(logouts).toHaveLength(2);
    expect(await databaseNames()).toEqual([]);
    expect(modules.session.readSession().status).toBe("signedOut");
    expect(localStorage.getItem("ghm-pending-logout")).toBe("[1]");
  });

  it("discards an account list that started before a sign-out", async () => {
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("ready");
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listings = 0;
    server.use(
      http.get("/auth/accounts", async () => {
        listings++;
        const listed = [...serverAccounts];
        if (listings === 1) await gate;
        return HttpResponse.json(listed);
      }),
    );
    const peer = new BroadcastChannel("ghm-session");
    peer.postMessage({ type: "accountsChanged" });
    await waitFor(() => {
      expect(listings).toBe(1);
    });
    await act(() => modules.session.signOut(2));
    serverAccounts = [OCTO];
    release();
    await waitFor(() => {
      expect(listings).toBe(2);
    });
    peer.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(modules.session.readSession().accounts.map((account) => account.id)).toEqual([1]);
    expect(await databaseNames()).not.toContain("ghm-drafts-2");
  });

  it("commits signedOut instead of a blank screen, then recovers online", async () => {
    server.use(http.get("/auth/accounts", () => HttpResponse.error()));
    const modules = await loadModules();
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("signedOut");
    });
    server.resetHandlers();
    window.dispatchEvent(new Event("online"));
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("ready");
    });
  });

  it("deletes databases of accounts that are neither listed nor pending", async () => {
    const modules = await loadModules();
    await modules.storage.writeEntry("cache", 9, "client", {});
    await modules.storage.writeEntry("drafts", 9, "comment", "orphan");
    localStorage.setItem("ghm-recent-searches-9", "[]");
    localStorage.setItem("ghm-recent-searches-8", "[]");
    localStorage.setItem("ghm-recent-searches-1", "[]");
    renderSession(modules);
    await waitFor(async () => {
      expect(await databaseNames()).not.toContain("ghm-drafts-9");
    });
    expect(await databaseNames()).not.toContain("ghm-cache-9");
    expect(localStorage.getItem("ghm-recent-searches-9")).toBeNull();
    expect(localStorage.getItem("ghm-recent-searches-8")).toBeNull();
    expect(localStorage.getItem("ghm-recent-searches-1")).toBe("[]");
  });
});

describe("stored cache rules", () => {
  const DAY_MS = 86_400_000;

  async function storedClient(
    modules: Modules,
    accountId: number,
    entries: readonly { key: string; result?: unknown; meta?: PersistenceMeta; ageMs?: number }[],
  ) {
    const client = new modules.query.QueryClient();
    for (const entry of entries) {
      await client.query({
        queryKey: [accountId, entry.key],
        queryFn: () => entry.result ?? entry.key,
        ...(entry.meta && { meta: entry.meta }),
      });
      if (entry.ageMs !== undefined) {
        client.setQueryData([accountId, entry.key], entry.key, {
          updatedAt: Date.now() - entry.ageMs,
        });
      }
    }
    const clientState = modules.query.dehydrate(client);
    await modules.storage.writeEntry("cache", accountId, "client", {
      timestamp: Date.now(),
      buster: "data-v1",
      clientState,
    });
  }

  it("purges every account cache when the setting turns off", async () => {
    const modules = await loadModules();
    const mixed = [
      { key: "user-search", meta: { persist: "user-search" } },
      { key: "public", meta: { private: false } },
      { key: "secret", meta: { private: true } },
      { key: "unclassified" },
    ] as const;
    for (const accountId of [1, 2]) {
      await storedClient(modules, accountId, mixed);
    }
    renderSession(modules);
    await waitFor(() => {
      expect(modules.session.readSession().status).toBe("ready");
    });
    await storedClient(modules, 9, mixed);
    act(() => {
      modules.preferences.setPreferences({ keepPrivateOffline: false });
    });
    await waitFor(async () => {
      for (const accountId of [1, 2, 9]) {
        expect(await storedKeys(modules, accountId)).toEqual([
          JSON.stringify([accountId, "user-search"]),
        ]);
      }
    });
  });

  it("purges known caches that finish opening during discovery", async () => {
    const modules = await loadModules();
    const { rewriteStoredCaches } = await import("./internal/persistence");
    const databases = indexedDB.databases.bind(indexedDB);
    vi.spyOn(indexedDB, "databases").mockImplementationOnce(async () => {
      const openingSnapshot = await databases();
      await storedClient(modules, 2, [
        { key: "user-search", meta: { persist: "user-search" } },
        { key: "legacy-repository" },
      ]);
      return openingSnapshot;
    });
    await rewriteStoredCaches([1, 2]);
    expect(await databaseNames()).toEqual(["ghm-cache-2"]);
    expect(await storedKeys(modules, 2)).toEqual(['[2,"user-search"]']);
  });

  it("restores only opted-in queries and purges preexisting caches on an off startup", async () => {
    const modules = await loadModules();
    modules.preferences.setPreferences({ keepPrivateOffline: false });
    const bio = "Develops offline tools";
    await storedClient(modules, 1, [
      { key: "user-search", meta: { persist: "user-search" } },
      {
        key: "profile",
        meta: { persist: "profile" },
        result: {
          login: OCTO.login,
          avatarUrl: OCTO.avatarUrl,
          bio,
          pinned: [{ name: "restricted-pin" }],
          readmeHtml: "<p>Restricted readme</p>",
          repositoryDescription: "Restricted description",
        },
      },
      { key: "legacy-repository" },
    ]);
    const clients: ReturnType<typeof modules.query.useQueryClient>[] = [];
    function Capture(): null {
      clients.push(modules.query.useQueryClient());
      return null;
    }
    renderSession(modules, <Capture />);
    await waitFor(() => {
      expect(clients[0]?.getQueryData([1, "user-search"])).toBe("user-search");
    });
    expect(clients[0]?.getQueryData([1, "legacy-repository"])).toBeUndefined();
    const profile = clients[0]?.getQueryData([1, "profile"]);
    expect(profile).toMatchObject({ login: OCTO.login, bio, pinned: [], readmeHtml: null });
    expect(profile).not.toHaveProperty("repositoryDescription");
    await waitFor(async () => {
      expect(await storedKeys(modules, 1)).toEqual(['[1,"profile"]', '[1,"user-search"]']);
      const stored = await persistedText();
      expect(stored).toContain(bio);
      expect(stored).not.toMatch(/restricted-pin|Restricted (readme|description)/);
    });
  });

  it("filters restored queries before another tab's storage event arrives", async () => {
    const modules = await loadModules();
    expect(modules.preferences.readPreferences().keepPrivateOffline).toBe(true);
    await storedClient(modules, 1, [
      { key: "user-search", meta: { persist: "user-search" } },
      { key: "legacy-repository" },
    ]);
    localStorage.setItem("ghm-preferences", JSON.stringify({ keepPrivateOffline: false }));
    const clients: ReturnType<typeof modules.query.useQueryClient>[] = [];
    function Capture(): null {
      clients.push(modules.query.useQueryClient());
      return null;
    }
    renderSession(modules, <Capture />);
    await waitFor(() => {
      expect(clients[0]?.getQueryData([1, "user-search"])).toBe("user-search");
    });
    expect(modules.preferences.readPreferences().keepPrivateOffline).toBe(true);
    expect(clients[0]?.getQueryData([1, "legacy-repository"])).toBeUndefined();
    expect(await storedKeys(modules, 1)).toEqual(['[1,"legacy-repository"]', '[1,"user-search"]']);
  });

  it("restores and keeps only queries updated within 7 days", async () => {
    const modules = await loadModules();
    await storedClient(modules, 1, [{ key: "fresh" }, { key: "stale", ageMs: 8 * DAY_MS }]);
    const clients: ReturnType<typeof modules.query.useQueryClient>[] = [];
    function Capture(): null {
      clients.push(modules.query.useQueryClient());
      return null;
    }
    renderSession(modules, <Capture />);
    await waitFor(() => {
      expect(clients[0]?.getQueryData([1, "fresh"])).toBe("fresh");
    });
    expect(clients[0]?.getQueryData([1, "stale"])).toBeUndefined();
  });
});

describe("parseSignInError", () => {
  it.each([
    "state_mismatch",
    "access_denied",
    "exchange_failed",
    "org_restricted",
    "account_limit",
  ] as const)("recognizes %s", async (code) => {
    const { session } = await loadModules();
    expect(session.parseSignInError(`?error=${code}`)).toBe(code);
  });

  it("ignores unknown codes", async () => {
    const { session } = await loadModules();
    expect(session.parseSignInError("?error=token_leaked")).toBeNull();
  });
});
