import { Suspense } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createTranslator, I18nProvider, loadMessages } from "@/i18n/index.tsx";
import { showErrorToast } from "./error-toast.ts";
import { dismissToast, showToast, ToastRegion } from "./Toast.tsx";

const SHORT_TIMEOUT_MS = 50;

const testToasts: number[] = [];

afterEach(() => {
  cleanup();
  for (const id of testToasts.splice(0)) dismissToast(id);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await loadMessages("en");
});

async function renderRegion() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <I18nProvider language="en">
          <ToastRegion />
        </I18nProvider>
      </Suspense>,
    );
    await loadMessages("en");
  });
  return screen.findByRole("region", { name: "Notifications" });
}

function presentToast(message: string, options?: Parameters<typeof showToast>[1]) {
  act(() => {
    testToasts.push(showToast(message, options));
  });
}

function advanceTime(milliseconds: number) {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

test("acting on a toast does not keep the next one paused", async () => {
  const region = await renderRegion();
  const onAction = vi.fn();
  showToast("Marked done", { timeoutMs: null, action: { label: "Undo", onAction } });
  const undo = await screen.findByRole("button", { name: "Undo" });
  fireEvent.pointerEnter(region);
  fireEvent.focus(undo);
  fireEvent.click(undo);
  expect(onAction).toHaveBeenCalledOnce();

  showToast("Marked read", { timeoutMs: SHORT_TIMEOUT_MS });
  await screen.findByText("Marked read");
  await waitFor(() => {
    expect(screen.queryByText("Marked read")).toBeNull();
  });
});

test("hovering pauses the timeout until the pointer leaves", async () => {
  const region = await renderRegion();
  showToast("Label removed", { timeoutMs: SHORT_TIMEOUT_MS });
  await screen.findByText("Label removed");
  fireEvent.pointerEnter(region);
  await new Promise((resolve) => setTimeout(resolve, SHORT_TIMEOUT_MS * 3));
  expect(screen.getByText("Label removed")).toBeTruthy();
  fireEvent.pointerLeave(region);
  await waitFor(() => {
    expect(screen.queryByText("Label removed")).toBeNull();
  });
});

test.each([
  {
    ssoUrl: "https://github.com/orgs/octo-org/sso",
    label: "errors.orgAccessRestricted.sso",
    destination: "https://github.com/orgs/octo-org/sso",
  },
  {
    ssoUrl: undefined,
    label: "errors.orgAccessRestricted.request",
    destination: "https://github.com/settings/applications",
  },
] as const)(
  "a restricted mutation explains the restriction and opens $destination",
  async ({ ssoUrl, label, destination }) => {
    await renderRegion();
    const t = createTranslator("en", await loadMessages("en"));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      showErrorToast(
        t,
        { kind: "orgAccessRestricted", org: "octo-org", ssoUrl },
        "Mutation failed",
      );
      const action = await screen.findByRole("button", { name: t(label) });
      expect(screen.getByRole("status").textContent).toContain(
        t("errors.orgAccessRestricted.title", { org: "octo-org" }),
      );
      expect(screen.getByRole("status").textContent).toContain(
        t("errors.orgAccessRestricted.message"),
      );
      fireEvent.click(action);
      expect(open).toHaveBeenCalledWith(destination, "_blank", "noopener,noreferrer");
    } finally {
      open.mockRestore();
    }
  },
);

test("a newer Undo toast preempts a sticky toast until the action is taken", async () => {
  await renderRegion();
  vi.useFakeTimers();
  const onUndo = vi.fn();
  presentToast("Update available", { timeoutMs: null });
  expect(screen.getByText("Update available")).toBeTruthy();

  presentToast("Marked done", {
    timeoutMs: "request",
    action: { label: "Undo", onAction: onUndo },
  });

  expect(screen.queryByText("Update available")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledOnce();
  expect(screen.getByText("Update available")).toBeTruthy();
});

test("a later toast waits until the Undo request starts", async () => {
  await renderRegion();
  vi.useFakeTimers();
  presentToast("Earlier sticky notice", { timeoutMs: null });
  act(() => {
    const undoId = showToast("Marked done", {
      timeoutMs: "request",
      action: { label: "Undo", onAction: vi.fn() },
    });
    testToasts.push(undoId);
    window.setTimeout(() => {
      dismissToast(undoId);
    }, SHORT_TIMEOUT_MS);
  });
  presentToast("Update available", { timeoutMs: null });
  advanceTime(SHORT_TIMEOUT_MS - 1);
  expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  expect(screen.queryByText("Update available")).toBeNull();
  advanceTime(1);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  expect(screen.getByText("Update available")).toBeTruthy();
});

test("overlapping request deadlines keep the first Undo reachable", async () => {
  await renderRegion();
  const undoFirst = vi.fn();
  const undoSecond = vi.fn();
  presentToast("First action", {
    timeoutMs: "request",
    action: { label: "Undo", onAction: undoFirst },
  });
  presentToast("Second action", {
    timeoutMs: "request",
    action: { label: "Undo", onAction: undoSecond },
  });
  expect(screen.getByText("First action")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undoFirst).toHaveBeenCalledOnce();
  expect(screen.getByText("Second action")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(undoSecond).toHaveBeenCalledOnce();
});

test("a timed toast spends only its remaining time after another toast covers it", async () => {
  const region = await renderRegion();
  vi.useFakeTimers();
  const firstVisibleMs = 10;
  presentToast("Marked read", { timeoutMs: SHORT_TIMEOUT_MS });
  advanceTime(firstVisibleMs);
  fireEvent.pointerEnter(region);
  presentToast("Update available", { timeoutMs: null });
  expect(screen.getByText("Update available")).toBeTruthy();
  expect(screen.queryByText("Marked read")).toBeNull();
  advanceTime(SHORT_TIMEOUT_MS * 2);

  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.getByText("Marked read")).toBeTruthy();
  advanceTime(SHORT_TIMEOUT_MS - firstVisibleMs - 1);
  expect(screen.getByText("Marked read")).toBeTruthy();
  advanceTime(1);
  expect(screen.queryByText("Marked read")).toBeNull();
});

test("the countdown pauses in a background tab", async () => {
  await renderRegion();
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  presentToast("Label removed", { timeoutMs: SHORT_TIMEOUT_MS });
  advanceTime(SHORT_TIMEOUT_MS * 2);
  expect(screen.getByText("Label removed")).toBeTruthy();

  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  advanceTime(SHORT_TIMEOUT_MS);
  expect(screen.queryByText("Label removed")).toBeNull();
});
