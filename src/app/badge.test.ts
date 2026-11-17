import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const stored = new Map<string, string>();
const setAppBadge = vi.fn(() => Promise.resolve());
const clearAppBadge = vi.fn(() => Promise.resolve());

// Preferences read storage at import time.
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
});
vi.stubGlobal("Notification", { permission: "granted" });
Object.assign(navigator, { setAppBadge, clearAppBadge });
const { setPreferences } = await import("@/data/preferences");
const { useAppBadge } = await import("./badge.ts");

afterEach(cleanup);

beforeEach(() => {
  setAppBadge.mockClear();
  clearAppBadge.mockClear();
  setPreferences({ unreadBadge: true });
});

test("shows the unread count and clears it at zero", () => {
  const { rerender } = renderHook(
    ({ count }) => {
      useAppBadge(count);
    },
    { initialProps: { count: 3 } },
  );
  expect(setAppBadge).toHaveBeenCalledWith(3);
  rerender({ count: 0 });
  expect(clearAppBadge).toHaveBeenCalledOnce();
});

test("turning the setting off clears the icon", () => {
  renderHook(() => {
    useAppBadge(5);
  });
  act(() => {
    setPreferences({ unreadBadge: false });
  });
  expect(clearAppBadge).toHaveBeenCalledOnce();
});
