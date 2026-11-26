import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { ScreenContext } from "@/app/navigation/screen.ts";
import { useFileSwipe } from "./file-swipe.ts";

beforeAll(() => {
  // jsdom lacks pointer capture.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
});

afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  vi.unstubAllGlobals();
});

afterEach(cleanup);

function SwipeSurface() {
  const {
    ref: surface,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  } = useFileSwipe({
    fileKey: "a.ts",
    enabled: true,
    canGo: () => true,
    onSwipe: vi.fn(),
  });
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div ref={surface}>Diff</div>
    </div>
  );
}

function renderSurface() {
  render(
    <ScreenContext
      value={{
        href: "/review",
        isRoot: false,
        scroller: { current: document.createElement("div") },
        match: { routeId: "/review", params: {}, search: {} },
      }}
    >
      <SwipeSurface />
    </ScreenContext>,
  );
  return screen.getByText("Diff");
}

function touchPointer(type: string, target: Element, x: number, y: number) {
  fireEvent(
    target,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 5,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

test("a horizontal file swipe keeps the page from scrolling", () => {
  const diff = renderSurface();
  touchPointer("pointerdown", diff, 200, 100);
  touchPointer("pointermove", diff, 150, 104);
  expect(fireEvent.touchMove(diff)).toBe(false);
});

test("a vertical drag over the diff scrolls the page", () => {
  const diff = renderSurface();
  touchPointer("pointerdown", diff, 200, 100);
  touchPointer("pointermove", diff, 204, 150);
  expect(fireEvent.touchMove(diff)).toBe(true);
});
