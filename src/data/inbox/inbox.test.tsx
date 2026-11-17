import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "../internal/test-doubles";
import { recordRateLimit, recordRateLimitBlock } from "../internal/rate-limit";
import type { Page } from "../types";
import {
  UNDO_WINDOW_MS,
  useBulkThreadAction,
  useInbox,
  useThreadAction,
  useUnreadCount,
  useUnsubscribeThread,
  type InboxThread,
} from ".";
import notifications from "./fixtures/notifications.json";
vi.mock("../session", () => ({
  useActiveAccount: () => ({ id: 103, login: "mona" }),
  useSession: () => ({ activeAccount: { id: 103, login: "mona" } }),
}));
const server = setupServer(
  http.post("/auth/token", () => HttpResponse.json({ accessToken: "gho_test", expiresAt: null })),
);
let client: QueryClient;
const seedThread: InboxThread = {
  id: "1",
  repo: { owner: "octo-org", name: "hello-mobile" },
  subjectType: "Issue",
  title: "Offline state",
  reason: "mention",
  unread: true,
  updatedAt: "2026-11-17T10:00:00Z",
  appPath: "/octo-org/hello-mobile/issues/13",
  webUrl: "https://github.com/octo-org/hello-mobile/issues/13",
};
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function seed() {
  for (const filter of ["all", "unread", "participating"])
    client.setQueryData([103, "inbox", filter], {
      pages: [{ items: [seedThread, { ...seedThread, id: "2" }], nextCursor: null }],
      pageParams: ["1"],
    });
}
function cached(filter: string) {
  return client.getQueryData<InfiniteData<Page<InboxThread>>>([103, "inbox", filter])?.pages[0]
    ?.items;
}
beforeAll(() => {
  installBrowserDoubles();
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  onlineManager.setOnline(true);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  recordRateLimit(103, "rest", {
    remaining: 100,
    limit: 100,
    resetAt: new Date(Date.now() + 3600000),
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});
describe("inbox reads", () => {
  it("maps API subject URLs and reuses cached pagination on 304", async () => {
    let requests = 0;
    server.use(
      http.get("https://api.github.com/notifications", ({ request }) => {
        requests++;
        const url = new URL(request.url);
        expect(url.searchParams.get("all")).toBe("true");
        expect(url.searchParams.get("is_done")).toBe("false");
        expect(url.searchParams.get("per_page")).toBe("50");
        if (requests > 1) {
          expect(request.headers.get("if-modified-since")).toBe("Tue, 17 Nov 2026 10:00:00 GMT");
          return new HttpResponse(null, { status: 304, headers: { "X-Poll-Interval": "120" } });
        }
        return HttpResponse.json(notifications, {
          headers: {
            "Last-Modified": "Tue, 17 Nov 2026 10:00:00 GMT",
            "X-Poll-Interval": "120",
            link: '<https://api.github.com/notifications?page=2>; rel="next"',
          },
        });
      }),
    );
    const { result } = renderHook(() => useInbox("all"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items.map((thread) => thread.appPath)).toEqual([
      "/octo-org/hello-mobile/issues/13",
      "/octo-org/hello-mobile/pull/12",
      "/octo-org/hello-mobile/commit/abc123def4567890abc123def4567890abc123de",
      "/octo-org/hello-mobile/releases",
      null,
    ]);
    expect(result.current.data?.pages[0]?.items[4]?.webUrl).toBe(
      "https://github.com/octo-org/hello-mobile/discussions/3",
    );
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data?.pages[0]?.items).toHaveLength(5);
    expect(result.current.data?.pages[0]?.nextCursor).toBe("2");
    expect(requests).toBe(2);
  });
  it("loads an exact unread count without mounting the Inbox screen", async () => {
    server.use(
      http.get("https://api.github.com/notifications", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("per_page")).toBe("1");
        expect(url.searchParams.has("all")).toBe(false);
        return HttpResponse.json([notifications[0]], {
          headers: {
            Link: '<https://api.github.com/notifications?per_page=1&page=237>; rel="last", <https://api.github.com/notifications?per_page=1&page=2>; rel="next"',
          },
        });
      }),
    );
    const { result } = renderHook(useUnreadCount, { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => {
      expect(result.current).toBe(237);
    });
    act(seed);
    expect(result.current).toBe(237);
  });
  it.each([0, 1])("counts %s unread notifications without pagination", async (count) => {
    server.use(
      http.get("https://api.github.com/notifications", () =>
        HttpResponse.json(notifications.slice(0, count)),
      ),
    );
    const { result } = renderHook(useUnreadCount, { wrapper });
    await waitFor(() => {
      expect(result.current).toBe(count);
    });
  });
  it("recovers an exact total after the account query client is recreated", async () => {
    let requests = 0;
    server.use(
      http.get("https://api.github.com/notifications", ({ request }) => {
        requests++;
        if (request.headers.has("if-modified-since"))
          return new HttpResponse(null, { status: 304 });
        return HttpResponse.json([notifications[0]], {
          headers: {
            "Last-Modified": "Tue, 17 Nov 2026 10:00:00 GMT",
            Link: '<https://api.github.com/notifications?per_page=1&page=237>; rel="last"',
          },
        });
      }),
    );
    const initial = renderHook(useUnreadCount, { wrapper });
    await waitFor(() => {
      expect(initial.result.current).toBe(237);
    });
    initial.unmount();
    client.clear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const recreated = renderHook(useUnreadCount, { wrapper });
    await waitFor(() => {
      expect(recreated.result.current).toBe(237);
    });
    expect(requests).toBe(3);
  });
  it.each(["10", "120"])(
    "polls the badge with X-Poll-Interval=%s and preserves totals on 304",
    async (seconds) => {
      let requests = 0;
      server.use(
        http.get("https://api.github.com/notifications", ({ request }) => {
          requests++;
          if (requests > 1) {
            expect(request.headers.get("if-modified-since")).toBe("Tue, 17 Nov 2026 10:00:00 GMT");
            return new HttpResponse(null, { status: 304, headers: { "X-Poll-Interval": seconds } });
          }
          return HttpResponse.json([notifications[0]], {
            headers: {
              "Last-Modified": "Tue, 17 Nov 2026 10:00:00 GMT",
              "X-Poll-Interval": seconds,
              Link: '<https://api.github.com/notifications?per_page=1&page=237>; rel="last"',
            },
          });
        }),
      );
      const { result } = renderHook(useUnreadCount, { wrapper });
      await waitFor(() => {
        expect(result.current).toBe(237);
      });
      vi.useFakeTimers();
      act(() => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      act(() => {
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      const interval = seconds === "10" ? 60_000 : 120_000;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval - 1);
      });
      expect(requests).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await vi.waitFor(() => {
          expect(requests).toBe(2);
          expect(client.getQueryState([103, "unreadCount"])?.fetchStatus).toBe("idle");
        });
      });
      expect(requests).toBe(2);
      expect(result.current).toBe(237);
      act(() => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval * 2);
      });
      expect(requests).toBe(2);
      act(() => {
        onlineManager.setOnline(false);
        Object.defineProperty(document, "visibilityState", {
          value: "visible",
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval * 2);
      });
      expect(requests).toBe(2);
      act(() => {
        recordRateLimit(103, "rest", {
          remaining: 5,
          limit: 100,
          resetAt: new Date(Date.now() + 3_600_000),
        });
        onlineManager.setOnline(true);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval * 2);
      });
      expect(requests).toBe(2);
      act(() => {
        recordRateLimitBlock(103, new Date(Date.now() + 3_600_000));
        recordRateLimit(103, "rest", {
          remaining: 100,
          limit: 100,
          resetAt: new Date(Date.now() + 3_600_000),
        });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(interval * 2);
      });
      expect(requests).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_600_000);
      });
    },
  );
  it.each(["read", "done", "bulk"] as const)(
    "refreshes the independent badge after %s actions",
    async (action) => {
      let unread = 237;
      server.use(
        http.get("https://api.github.com/notifications", () =>
          HttpResponse.json([notifications[0]], {
            headers: {
              Link: `<https://api.github.com/notifications?per_page=1&page=${String(unread)}>; rel="last"`,
            },
          }),
        ),
        http.patch("https://api.github.com/notifications/threads/1", () => {
          unread--;
          return new HttpResponse(null, { status: 205 });
        }),
        http.delete("https://api.github.com/notifications/threads/1", () => {
          unread--;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const { result } = renderHook(
        () => ({ count: useUnreadCount(), thread: useThreadAction(), bulk: useBulkThreadAction() }),
        { wrapper },
      );
      await waitFor(() => {
        expect(result.current.count).toBe(237);
      });
      vi.useFakeTimers();
      await act(async () => {
        const completion =
          action === "bulk"
            ? result.current.bulk.run("done", ["1"])
            : result.current.thread(action, "1").settled;
        await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
        await completion;
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current.count).toBe(236);
    },
  );
  it("honors poll interval and pauses while hidden or rate limited", async () => {
    let requests = 0;
    server.use(
      http.get("https://api.github.com/notifications", () => {
        requests++;
        return HttpResponse.json([], { headers: { "X-Poll-Interval": "120" } });
      }),
    );
    const { result } = renderHook(() => useInbox("unread"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(requests).toBe(1);
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180000);
    });
    expect(requests).toBe(1);
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      recordRateLimit(103, "rest", {
        remaining: 5,
        limit: 100,
        resetAt: new Date(Date.now() + 3600000),
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180000);
    });
    expect(requests).toBe(1);
  });
});
describe("deferred thread actions", () => {
  it("updates every filter immediately and undo sends no request", async () => {
    seed();
    vi.useFakeTimers();
    let writes = 0;
    server.use(
      http.patch("https://api.github.com/notifications/threads/1", () => {
        writes++;
        return new HttpResponse(null, { status: 205 });
      }),
    );
    const { result } = renderHook(useThreadAction, { wrapper });
    let action: ReturnType<ReturnType<typeof useThreadAction>> | undefined;
    act(() => {
      action = result.current("read", "1");
    });
    expect(cached("unread")?.map((thread) => thread.id)).toEqual(["2"]);
    expect(cached("all")?.[0]?.unread).toBe(false);
    expect(cached("participating")?.[0]?.unread).toBe(false);
    act(() => {
      action?.undo();
    });
    await action?.settled;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    });
    expect(writes).toBe(0);
    expect(cached("unread")?.map((thread) => thread.id)).toEqual(["1", "2"]);
  });
  it("waits five seconds before sending done once", async () => {
    seed();
    vi.useFakeTimers();
    let writes = 0;
    server.use(
      http.delete("https://api.github.com/notifications/threads/1", () => {
        writes++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(useThreadAction, { wrapper });
    const action = result.current("done", "1");
    expect(cached("all")?.map((thread) => thread.id)).toEqual(["2"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1);
    });
    expect(writes).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await action.settled;
    });
    expect(writes).toBe(1);
  });
  it("reports when sending starts, after which undo does nothing", async () => {
    seed();
    vi.useFakeTimers();
    let writes = 0;
    server.use(
      http.delete("https://api.github.com/notifications/threads/1", () => {
        writes++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onSend = vi.fn();
    const { result } = renderHook(useThreadAction, { wrapper });
    const action = result.current("done", "1", { onSend });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1);
    });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onSend).toHaveBeenCalledOnce();
    action.undo();
    await act(async () => {
      await action.settled;
    });
    expect(writes).toBe(1);
    expect(cached("all")?.map((thread) => thread.id)).toEqual(["2"]);
  });
  it("sends immediately when asked, without the undo window", async () => {
    seed();
    vi.useFakeTimers();
    let writes = 0;
    server.use(
      http.patch("https://api.github.com/notifications/threads/1", () => {
        writes++;
        return new HttpResponse(null, { status: 205 });
      }),
    );
    const { result } = renderHook(useThreadAction, { wrapper });
    const action = result.current("read", "1", { immediate: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await action.settled;
    });
    expect(writes).toBe(1);
  });
  it("rejects on failure and restores only the failed thread", async () => {
    seed();
    vi.useFakeTimers();
    server.use(
      http.delete("https://api.github.com/notifications/threads/1", () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );
    const { result } = renderHook(useThreadAction, { wrapper });
    const first = result.current("done", "1");
    const second = result.current("read", "2");
    const rejected = expect(first.settled).rejects.toMatchObject({ kind: "forbidden" });
    second.undo();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
      await rejected;
    });
    expect(cached("all")?.map((thread) => thread.id)).toEqual(["1", "2"]);
    expect(cached("all")?.every((thread) => thread.unread)).toBe(true);
  });
});
it("unsubscribes by ignoring the thread subscription", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.put("https://api.github.com/notifications/threads/1/subscription", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ subscribed: false, ignored: true });
    }),
  );
  const { result } = renderHook(useUnsubscribeThread, { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ threadId: "1" });
  });
  expect(bodies).toEqual([{ ignored: true }]);
});
it("bulk reports partial success and stops on secondary rate limit", async () => {
  seed();
  for (const filter of ["all", "unread", "participating"])
    client.setQueryData([103, "inbox", filter], {
      pages: [
        { items: ["1", "2", "3", "4"].map((id) => ({ ...seedThread, id })), nextCursor: null },
      ],
      pageParams: ["1"],
    });
  vi.useFakeTimers();
  const writes: string[] = [];
  server.use(
    http.delete("https://api.github.com/notifications/threads/:id", ({ params }) => {
      writes.push(String(params.id));
      return params.id === "2"
        ? HttpResponse.json(
            { message: "You have exceeded a secondary rate limit" },
            { status: 403, headers: { "retry-after": "60" } },
          )
        : new HttpResponse(null, { status: 204 });
    }),
  );
  const { result } = renderHook(useBulkThreadAction, { wrapper });
  let completion: Promise<unknown> | undefined;
  act(() => {
    completion = result.current.run("done", ["1", "2", "3", "4"]);
  });
  for (const filter of ["all", "unread", "participating"]) expect(cached(filter)).toEqual([]);
  expect(writes).toEqual([]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
    await completion;
  });
  await expect(completion).resolves.toMatchObject({
    total: 4,
    done: 1,
    failed: 1,
    stoppedByRateLimit: true,
    running: false,
  });
  expect(writes).toEqual(["1", "2"]);
  for (const filter of ["all", "unread", "participating"])
    expect(cached(filter)?.map((thread) => thread.id)).toEqual(["2", "3", "4"]);
});

it.each([
  { label: "forbidden", org: null },
  { label: "organization restriction", org: "octo-org" },
])("bulk mark-read rolls back only failed ids across filters ($label)", async ({ org }) => {
  seed();
  vi.useFakeTimers();
  const ssoUrl = `https://github.com/orgs/${org ?? "octo-org"}/sso`;
  server.use(
    http.patch("https://api.github.com/notifications/threads/:id", ({ params }) =>
      params.id === "2"
        ? HttpResponse.json(
            { message: "Forbidden" },
            {
              status: 403,
              ...(org ? { headers: { "x-github-sso": `required; url=${ssoUrl}` } } : {}),
            },
          )
        : new HttpResponse(null, { status: 205 }),
    ),
  );
  const { result } = renderHook(useBulkThreadAction, { wrapper });
  let completion: Promise<unknown> | undefined;
  act(() => {
    completion = result.current.run("read", ["1", "2"]);
  });
  expect(cached("unread")).toEqual([]);
  expect(cached("all")?.every((thread) => !thread.unread)).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
    await completion;
  });
  await expect(completion).resolves.toMatchObject({
    done: 1,
    failed: 1,
    stoppedByRateLimit: false,
    restrictions: org ? [{ kind: "orgAccessRestricted", org, ssoUrl }] : [],
  });
  expect(cached("unread")?.map((thread) => thread.id)).toEqual(["2"]);
  expect(cached("all")?.map((thread) => [thread.id, thread.unread])).toEqual([
    ["1", false],
    ["2", true],
  ]);
  expect(cached("participating")?.map((thread) => [thread.id, thread.unread])).toEqual([
    ["1", false],
    ["2", true],
  ]);
});
