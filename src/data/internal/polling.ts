import { useSyncExternalStore } from "react";
import { useSession } from "../session";
import { useIsOffline, useIsRateLimitLow } from "../status";
import { MINUTE_MS, SECOND_MS } from "./constants";
import { rateLimitBlockedUntil, subscribeRateLimits } from "./rate-limit";

export const MIN_POLL_INTERVAL_MS = MINUTE_MS;

export function pollIntervalFrom(headers: Headers): number {
  const seconds = Number(headers.get("x-poll-interval"));
  return Number.isFinite(seconds)
    ? Math.max(MIN_POLL_INTERVAL_MS, seconds * SECOND_MS)
    : MIN_POLL_INTERVAL_MS;
}

function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener("visibilitychange", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
  };
}

export function usePollingInterval(intervalMs: number): number | false {
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
  );
  const offline = useIsOffline();
  const low = useIsRateLimitLow();
  const accountId = useSession().activeAccount?.id ?? null;
  const blocked = useSyncExternalStore(
    subscribeRateLimits,
    () => rateLimitBlockedUntil(accountId) !== null,
  );
  if (!visible || offline || low || blocked) return false;
  return Math.max(MIN_POLL_INTERVAL_MS, intervalMs);
}
