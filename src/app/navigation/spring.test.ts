import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpring } from "./spring.ts";

describe("runSpring", () => {
  let queue: Map<number, FrameRequestCallback>;
  let nextId: number;
  let now: number;

  beforeEach(() => {
    queue = new Map();
    nextId = 1;
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      queue.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stepFrame(deltaMs = 16): void {
    now += deltaMs;
    const pending = [...queue.entries()];
    queue.clear();
    for (const [, cb] of pending) cb(now);
  }

  it("converges monotonically to the target and calls onDone", () => {
    const values: number[] = [];
    const onDone = vi.fn();
    runSpring(0, 300, 0, (value) => values.push(value), onDone);
    for (let i = 0; i < 120 && onDone.mock.calls.length === 0; i++) stepFrame();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(values.at(-1)).toBe(300);
    expect(values.every((value) => value >= 0 && value <= 300)).toBe(true);
  });

  it("stops animating immediately when cancelled", () => {
    const onFrame = vi.fn();
    const onDone = vi.fn();
    const run = runSpring(100, 0, -0.5, onFrame, onDone);
    stepFrame();
    expect(onFrame).toHaveBeenCalledTimes(1);
    run.cancel();
    stepFrame();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
