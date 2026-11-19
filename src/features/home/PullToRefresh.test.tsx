import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ScreenContext } from "@/app/navigation/screen.ts";
import { I18nProvider, loadMessages } from "@/i18n/index.tsx";
import { PullToRefresh } from "./PullToRefresh.tsx";

afterEach(cleanup);

test("only a completed single-finger pull refreshes the active screen", async () => {
  const root = document.createElement("div");
  const refresh = vi.fn();
  await act(async () => {
    render(
      <I18nProvider language="en">
        <ScreenContext
          value={{
            href: "/",
            isRoot: true,
            isTop: true,
            scroller: { current: root },
            match: { routeId: "/", params: {}, search: {} },
          }}
        >
          <PullToRefresh refreshing={false} onRefresh={refresh}>
            Activity
          </PullToRefresh>
        </ScreenContext>
      </I18nProvider>,
      { container: root },
    );
    await loadMessages("en");
  });
  const start = { clientX: 100, clientY: 20 };
  const move = (clientX: number, clientY: number) =>
    fireEvent.touchMove(root, { touches: [{ clientX, clientY }] });
  const pull = () => {
    fireEvent.touchStart(root, { touches: [start] });
    move(100, 50);
    move(100, 160);
  };

  pull();
  fireEvent.touchCancel(root);
  pull();
  fireEvent.touchStart(root, { touches: [start, { clientX: 200, clientY: 50 }] });
  fireEvent.touchEnd(root);
  fireEvent.touchStart(root, { touches: [start] });
  move(200, 25);
  move(200, 230);
  fireEvent.touchEnd(root);
  expect(refresh).toHaveBeenCalledTimes(0);

  pull();
  fireEvent.touchEnd(root);
  expect(refresh).toHaveBeenCalledTimes(1);
});
