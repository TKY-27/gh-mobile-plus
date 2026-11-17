import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "./test-doubles";

const ACCOUNT_ID = 5;
const server = setupServer(
  http.get("/auth/accounts", () =>
    HttpResponse.json([
      { id: ACCOUNT_ID, login: "octo", avatarUrl: "https://a.example/5", publicOnly: false },
    ]),
  ),
);

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function renderPolling() {
  vi.resetModules();
  const session = await import("../session");
  const polling = await import("./polling");
  const rateLimit = await import("./rate-limit");
  const { onlineManager } = await import("@tanstack/react-query");
  function Wrapper(props: { children: ReactNode }): ReactNode {
    return <session.SessionProvider>{props.children}</session.SessionProvider>;
  }
  const hook = renderHook(() => polling.usePollingInterval(120_000), { wrapper: Wrapper });
  await waitFor(() => {
    expect(session.readSession().status).toBe("ready");
  });
  return { hook, rateLimit, onlineManager };
}

function limit(remaining: number) {
  return { limit: 100, remaining, resetAt: new Date(Date.now() + 600_000) };
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  setVisibility("visible");
});
afterEach(() => {
  cleanup();
});
afterAll(() => {
  server.close();
});

describe("usePollingInterval", () => {
  it("polls at the server interval while visible and stops while hidden", async () => {
    const { hook } = await renderPolling();
    expect(hook.result.current).toBe(120_000);
    act(() => {
      setVisibility("hidden");
    });
    expect(hook.result.current).toBe(false);
  });

  it("stops while offline", async () => {
    const { hook, onlineManager } = await renderPolling();
    act(() => {
      onlineManager.setOnline(false);
    });
    expect(hook.result.current).toBe(false);
    act(() => {
      onlineManager.setOnline(true);
    });
    expect(hook.result.current).toBe(120_000);
  });

  it("stops below 10 % remaining, not at exactly 10 %", async () => {
    const { hook, rateLimit } = await renderPolling();
    act(() => {
      rateLimit.recordRateLimit(ACCOUNT_ID, "core", limit(10));
    });
    expect(hook.result.current).toBe(120_000);
    act(() => {
      rateLimit.recordRateLimit(ACCOUNT_ID, "core", limit(9));
    });
    expect(hook.result.current).toBe(false);
  });

  it("stays paused until a rate-limit block resets", async () => {
    const { hook, rateLimit } = await renderPolling();
    act(() => {
      rateLimit.recordRateLimitBlock(ACCOUNT_ID, new Date(Date.now() + 100));
    });
    expect(hook.result.current).toBe(false);
    await waitFor(() => {
      expect(hook.result.current).toBe(120_000);
    });
  });
});

describe("pollIntervalFrom", () => {
  it("honors X-Poll-Interval but never polls faster than 60 s", async () => {
    const { MIN_POLL_INTERVAL_MS, pollIntervalFrom } = await import("./polling");
    expect(pollIntervalFrom(new Headers({ "X-Poll-Interval": "120" }))).toBe(120_000);
    expect(pollIntervalFrom(new Headers({ "X-Poll-Interval": "10" }))).toBe(MIN_POLL_INTERVAL_MS);
    expect(pollIntervalFrom(new Headers())).toBe(MIN_POLL_INTERVAL_MS);
  });
});
