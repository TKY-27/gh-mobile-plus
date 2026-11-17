import { notifyManager, onlineManager, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  isRateLimitLow,
  lowestRateLimit,
  subscribeRateLimits,
  type RateLimit,
} from "./internal/rate-limit";
import { useSession } from "./session";

function useActiveAccountId(): number | null {
  return useSession().activeAccount?.id ?? null;
}

export function useRateLimit(): RateLimit | null {
  const accountId = useActiveAccountId();
  return useSyncExternalStore(subscribeRateLimits, () => lowestRateLimit(accountId));
}

export function useIsRateLimitLow(): boolean {
  return isRateLimitLow(useRateLimit());
}

export function useIsOffline(): boolean {
  return !useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
}

export function useIsShowingCachedData(): boolean {
  const offline = useIsOffline();
  const queryCache = useQueryClient().getQueryCache();
  const hasCachedData = useSyncExternalStore(
    // Batched: events may fire during another render.
    (listener) => queryCache.subscribe(notifyManager.batchCalls(listener)),
    () => queryCache.getAll().some((query) => query.state.data !== undefined),
  );
  return offline && hasCachedData;
}
