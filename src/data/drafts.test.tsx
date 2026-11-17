import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "./internal/test-doubles";

const ACCOUNTS = [
  { id: 7, login: "octo", avatarUrl: "https://avatars.example/7", publicOnly: false },
  { id: 8, login: "hubot", avatarUrl: "https://avatars.example/8", publicOnly: false },
];
const server = setupServer(http.get("/auth/accounts", () => HttpResponse.json(ACCOUNTS)));

function saved(value: unknown): { version: number; value: unknown } {
  return { version: 1, value };
}

async function setup() {
  vi.resetModules();
  const session = await import("./session");
  const drafts = await import("./drafts");
  const storage = await import("./internal/storage");
  function Wrapper(props: { children: ReactNode }): ReactNode {
    return (
      <session.SessionProvider>
        <SignedIn>{props.children}</SignedIn>
      </session.SessionProvider>
    );
  }
  function SignedIn(props: { children: ReactNode }): ReactNode {
    return session.useSession().activeAccount ? props.children : null;
  }
  return { session, drafts, storage, Wrapper };
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
});

describe("useDraft", () => {
  it("saves once after 500 ms of quiet into the account's drafts database", async () => {
    const { drafts, storage, Wrapper } = await setup();
    const key = drafts.draftKeys.comment("o", "r", 1);
    const { result } = renderHook(() => drafts.useDraft(key, ""), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current[3]).toBe(true);
    });
    const writes = vi.spyOn(storage, "writeEntry");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      result.current[1]("H");
    });
    act(() => {
      result.current[1]("Hi");
    });
    expect(result.current[0]).toBe("Hi");
    await act(() => vi.advanceTimersByTimeAsync(499));
    expect(writes).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledWith("drafts", 7, key, saved("Hi"));
    vi.useRealTimers();
    await waitFor(async () => {
      expect(await storage.readEntry("drafts", 7, key)).toEqual(saved("Hi"));
    });
  });

  it("restores a saved draft and flushes pending edits on unmount", async () => {
    const { drafts, storage, Wrapper } = await setup();
    const key = drafts.draftKeys.newIssue("o", "r");
    await storage.writeEntry("drafts", 7, key, saved({ title: "Saved" }));
    const first = renderHook(() => drafts.useDraft(key, { title: "" }), { wrapper: Wrapper });
    await waitFor(() => {
      expect(first.result.current).toMatchObject([
        { title: "Saved" },
        expect.any(Function),
        expect.any(Function),
        true,
      ]);
    });
    act(() => {
      first.result.current[1]({ title: "Edited" });
    });
    first.unmount();
    await waitFor(async () => {
      expect(await storage.readEntry("drafts", 7, key)).toEqual(saved({ title: "Edited" }));
    });
  });

  it("clears the stored value", async () => {
    const { drafts, storage, Wrapper } = await setup();
    const key = drafts.draftKeys.pendingReview("o", "r", 3);
    await storage.writeEntry("drafts", 7, key, saved(["comment"]));
    const { result } = renderHook(() => drafts.useDraft<string[]>(key, []), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current[0]).toEqual(["comment"]);
    });
    act(() => {
      result.current[2]();
    });
    expect(result.current[0]).toEqual([]);
    await waitFor(async () => {
      expect(await storage.readEntry("drafts", 7, key)).toBeUndefined();
    });
  });

  it("keeps drafts per account", async () => {
    const { session, drafts, storage, Wrapper } = await setup();
    const key = drafts.draftKeys.comment("o", "r", 9);
    await storage.writeEntry("drafts", 8, key, saved("hubot's draft"));
    const { result } = renderHook(() => drafts.useDraft(key, ""), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current[3]).toBe(true);
    });
    expect(result.current[0]).toBe("");
    act(() => {
      session.switchAccount(8);
    });
    await waitFor(() => {
      expect(result.current[0]).toBe("hubot's draft");
    });
  });

  it("drops drafts from another format version or of another shape", async () => {
    const { drafts, storage, Wrapper } = await setup();
    const oldKey = drafts.draftKeys.comment("o", "r", 20);
    const wrongShapeKey = drafts.draftKeys.comment("o", "r", 21);
    await storage.writeEntry("drafts", 7, oldKey, "unversioned text");
    await storage.writeEntry("drafts", 7, wrongShapeKey, saved(["not", "a", "string"]));
    const old = renderHook(() => drafts.useDraft(oldKey, ""), { wrapper: Wrapper });
    const wrongShape = renderHook(() => drafts.useDraft(wrongShapeKey, ""), { wrapper: Wrapper });
    await waitFor(() => {
      expect(old.result.current[3] && wrongShape.result.current[3]).toBe(true);
    });
    expect(old.result.current[0]).toBe("");
    expect(wrongShape.result.current[0]).toBe("");
    await waitFor(async () => {
      expect(await storage.readEntry("drafts", 7, oldKey)).toBeUndefined();
    });
  });

  it("saves pending edits when the page is hidden or unloaded", async () => {
    const { drafts, storage, Wrapper } = await setup();
    const key = drafts.draftKeys.comment("o", "r", 30);
    const { result } = renderHook(() => drafts.useDraft(key, ""), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current[3]).toBe(true);
    });
    act(() => {
      result.current[1]("before hide");
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await storage.readEntry("drafts", 7, key)).toEqual(saved("before hide"));
    act(() => {
      result.current[1]("before unload");
    });
    window.dispatchEvent(new Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await storage.readEntry("drafts", 7, key)).toEqual(saved("before unload"));
  });

  it("builds unambiguous keys for file edits", async () => {
    const { drafts } = await setup();
    expect(drafts.draftKeys.fileEdit("o", "r", "a/b", "c")).not.toBe(
      drafts.draftKeys.fileEdit("o", "r", "a", "b/c"),
    );
  });
});
