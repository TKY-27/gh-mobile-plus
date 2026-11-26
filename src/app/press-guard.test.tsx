import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "react-aria-components/Button";
import { installPressGuard } from "./press-guard.ts";

function touch(type: string, target: Element, x: number, y = 0) {
  fireEvent(
    target,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

describe("installPressGuard", () => {
  let uninstall: () => void = () => undefined;
  afterEach(() => {
    cleanup();
    uninstall();
    vi.useRealTimers();
  });

  it("cancels a press once a touch drags past the slop", () => {
    vi.useFakeTimers();
    uninstall = installPressGuard(window);
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Open</Button>);
    const button = screen.getByRole("button");
    touch("pointerdown", button, 0);
    touch("pointermove", button, 40);
    touch("pointerup", button, 40);
    vi.advanceTimersByTime(200);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("keeps a tap with small finger jitter", () => {
    vi.useFakeTimers();
    uninstall = installPressGuard(window);
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Open</Button>);
    const button = screen.getByRole("button");
    touch("pointerdown", button, 0);
    touch("pointermove", button, 4, 3);
    touch("pointerup", button, 4, 3);
    vi.advanceTimersByTime(200);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
