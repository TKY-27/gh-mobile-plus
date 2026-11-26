import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { ScreenContext } from "@/app/navigation/screen.ts";
import type { InboxThread } from "@/data/inbox";
import { I18nProvider, loadMessages } from "@/i18n/index.tsx";
import { InboxRow } from "./InboxRow.tsx";

const THREAD: InboxThread = {
  id: "1",
  repo: { owner: "octo", name: "app" },
  subjectType: "Issue",
  title: "Crash on launch",
  reason: "mention",
  unread: true,
  updatedAt: "2026-11-20T00:00:00Z",
  appPath: null,
  webUrl: "https://github.com/octo/app/issues/1",
};

beforeAll(() => {
  // jsdom lacks pointer capture.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function touchPointer(type: string, target: Element, x: number, y: number) {
  fireEvent(
    target,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 3,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

async function renderRow(onShowActions = vi.fn()) {
  const scroller = document.createElement("div");
  await act(async () => {
    render(
      <I18nProvider language="en">
        <ScreenContext
          value={{
            href: "/inbox",
            isRoot: true,
            scroller: { current: scroller },
            match: { routeId: "/inbox", params: {}, search: {} },
          }}
        >
          <InboxRow
            thread={THREAD}
            selecting={false}
            offline={false}
            selected={false}
            removesOnRead
            onSelectedChange={vi.fn()}
            onOpen={vi.fn()}
            onAction={vi.fn()}
            onShowActions={onShowActions}
          />
        </ScreenContext>
      </I18nProvider>,
    );
    await loadMessages("en");
  });
  return {
    open: await screen.findByRole("button", { name: /octo\/app/ }),
    actions: screen.getByRole("button", { name: "Actions for Crash on launch" }),
  };
}

test("a horizontal swipe keeps the page from scrolling", async () => {
  const { open } = await renderRow();
  touchPointer("pointerdown", open, 100, 100);
  touchPointer("pointermove", open, 140, 104);
  const scrolled = fireEvent.touchMove(open);
  expect(scrolled).toBe(false);
});

test("a vertical drag scrolls the page", async () => {
  const { open } = await renderRow();
  touchPointer("pointerdown", open, 100, 100);
  touchPointer("pointermove", open, 104, 140);
  const scrolled = fireEvent.touchMove(open);
  expect(scrolled).toBe(true);
});

test("a swipe can start on the actions button, and a tap still opens it", async () => {
  const onShowActions = vi.fn();
  const { actions } = await renderRow(onShowActions);
  vi.useFakeTimers();
  touchPointer("pointerdown", actions, 300, 100);
  touchPointer("pointermove", actions, 260, 102);
  expect(fireEvent.touchMove(actions)).toBe(false);
  touchPointer("pointercancel", actions, 260, 102);
  expect(onShowActions).not.toHaveBeenCalled();

  touchPointer("pointerdown", actions, 300, 100);
  touchPointer("pointerup", actions, 300, 100);
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(onShowActions).toHaveBeenCalledOnce();
});
