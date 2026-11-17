import { isGitHubError } from "../errors";
import { sleep } from "./sleep";

export const MAX_CONCURRENT_WRITES = 4;
export const WRITE_SPACING_MS = 250;

export interface WriteQueueProgress {
  total: number;
  done: number;
  failed: number;
  stoppedByRateLimit: boolean;
}

export async function runThrottledWrites<Entry>(
  entries: readonly Entry[],
  write: (entry: Entry) => Promise<unknown>,
  onProgress?: (progress: WriteQueueProgress) => void,
  onFailure?: (error: unknown) => void,
): Promise<WriteQueueProgress> {
  const progress: WriteQueueProgress = {
    total: entries.length,
    done: 0,
    failed: 0,
    stoppedByRateLimit: false,
  };
  const running = new Set<Promise<void>>();
  let nextStartAt = 0;
  for (const entry of entries) {
    if (running.size >= MAX_CONCURRENT_WRITES) await Promise.race(running);
    await sleep(nextStartAt - Date.now());
    if (progress.stoppedByRateLimit) break;
    nextStartAt = Date.now() + WRITE_SPACING_MS;
    const task = write(entry)
      .then(
        () => {
          progress.done++;
        },
        (error: unknown) => {
          progress.failed++;
          if (!isGitHubError(error)) reportError(error);
          else if (error.kind === "rateLimited" && error.secondary) {
            progress.stoppedByRateLimit = true;
          }
          onFailure?.(error);
        },
      )
      .finally(() => {
        running.delete(task);
        onProgress?.({ ...progress });
      });
    running.add(task);
  }
  await Promise.all(running);
  return { ...progress };
}
