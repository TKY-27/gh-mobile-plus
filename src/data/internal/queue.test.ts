import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitHubFailure } from "./errors";
import { MAX_CONCURRENT_WRITES, runThrottledWrites, WRITE_SPACING_MS } from "./queue";

const WRITE_DURATION_MS = 2000;

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});
afterEach(() => {
  vi.useRealTimers();
});

function timedWrites(outcome: (entry: number) => Error | null = () => null) {
  const starts: number[] = [];
  let active = 0;
  let maxActive = 0;
  const write = async (entry: number): Promise<void> => {
    starts.push(Date.now());
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, WRITE_DURATION_MS));
    active--;
    const failure = outcome(entry);
    if (failure) throw failure;
  };
  return { write, starts, maxActive: () => maxActive };
}

describe("runThrottledWrites", () => {
  it("runs at most 4 at once, 250 ms apart, and reports progress", async () => {
    const writes = timedWrites((entry) =>
      entry === 3 ? gitHubFailure({ kind: "notFound" }) : null,
    );
    const progress: unknown[] = [];
    const run = runThrottledWrites([1, 2, 3, 4, 5, 6], writes.write, (update) =>
      progress.push(update),
    );
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ total: 6, done: 5, failed: 1, stoppedByRateLimit: false });
    expect(writes.maxActive()).toBe(MAX_CONCURRENT_WRITES);
    writes.starts.slice(1).forEach((start, index) => {
      expect(start - (writes.starts[index] ?? 0)).toBeGreaterThanOrEqual(WRITE_SPACING_MS);
    });
    expect(progress).toHaveLength(6);
  });

  it("stops starting writes after a secondary rate limit", async () => {
    const limited = gitHubFailure({
      kind: "rateLimited",
      resetAt: new Date(60_000),
      secondary: true,
    });
    const writes = timedWrites((entry) => (entry === 1 ? limited : null));
    const run = runThrottledWrites([1, 2, 3, 4, 5, 6, 7, 8], writes.write);
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ total: 8, done: 3, failed: 1, stoppedByRateLimit: true });
    expect(writes.starts).toHaveLength(4);
  });

  it("finishes immediately for an empty list", async () => {
    await expect(runThrottledWrites([], () => Promise.resolve())).resolves.toEqual({
      total: 0,
      done: 0,
      failed: 0,
      stoppedByRateLimit: false,
    });
  });
});
