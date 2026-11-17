import { describe, expect, it } from "vitest";
import { actionFor, commitDistance, rubberBand, shouldCommit } from "./swipe.ts";

const WIDTH = 400;

describe("swipe", () => {
  it("maps right to Done and left to Mark read", () => {
    expect(actionFor(12)).toBe("done");
    expect(actionFor(-12)).toBe("read");
    expect(actionFor(0)).toBeNull();
  });

  it("caps the commit distance on wide rows", () => {
    expect(commitDistance(WIDTH)).toBe(140);
    expect(commitDistance(1200)).toBe(160);
  });

  it("tracks the finger, then resists without ever reaching the limit", () => {
    expect(rubberBand(80, 140, WIDTH)).toBe(80);
    expect(rubberBand(-80, 140, WIDTH)).toBe(-80);
    const far = rubberBand(2000, 140, WIDTH);
    expect(far).toBeGreaterThan(140);
    expect(far).toBeLessThan(140 + WIDTH);
    expect(rubberBand(300, 140, WIDTH)).toBeLessThan(300);
    expect(rubberBand(-300, 140, WIDTH)).toBe(-rubberBand(300, 140, WIDTH));
  });

  it("commits past the threshold or on a fast flick, not on a reversal", () => {
    expect(shouldCommit(150, 0, 140)).toBe(true);
    expect(shouldCommit(60, 1, 140)).toBe(true);
    expect(shouldCommit(60, 0.1, 140)).toBe(false);
    expect(shouldCommit(150, -2, 140)).toBe(false);
    expect(shouldCommit(-150, 0, 140)).toBe(true);
  });
});
