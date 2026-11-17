import type { AccountId } from "../session";
import { MAX_TIMER_MS, MINUTE_MS, SECOND_MS } from "./constants";

export interface RateLimit {
  remaining: number;
  limit: number;
  resetAt: Date;
}

interface AccountLimits {
  byResource: Map<string, RateLimit>;
  lowest: RateLimit | null;
  blockedUntil: Date | null;
  expiryTimer: ReturnType<typeof setTimeout> | undefined;
  consecutiveSecondaryLimits: number;
}

const SECONDARY_BACKOFF_BASE_MS = MINUTE_MS;
// Per-minute buckets like search would flicker.
const TRACKED_RESOURCES: ReadonlySet<string> = new Set(["core", "graphql"]);

const accounts = new Map<AccountId, AccountLimits>();
const listeners = new Set<() => void>();

function limitsOf(accountId: AccountId): AccountLimits {
  let limits = accounts.get(accountId);
  if (!limits) {
    limits = {
      byResource: new Map(),
      lowest: null,
      blockedUntil: null,
      expiryTimer: undefined,
      consecutiveSecondaryLimits: 0,
    };
    accounts.set(accountId, limits);
  }
  return limits;
}

function ratio(limit: RateLimit): number {
  return limit.limit > 0 ? limit.remaining / limit.limit : 0;
}

function recompute(limits: AccountLimits): void {
  const now = Date.now();
  for (const [resource, limit] of limits.byResource) {
    if (limit.resetAt.getTime() <= now) limits.byResource.delete(resource);
  }
  if (limits.blockedUntil && limits.blockedUntil.getTime() <= now) limits.blockedUntil = null;
  limits.lowest = null;
  for (const limit of limits.byResource.values()) {
    if (!limits.lowest || ratio(limit) < ratio(limits.lowest)) limits.lowest = limit;
  }
  const expiries = [...limits.byResource.values()].map((limit) => limit.resetAt.getTime());
  if (limits.blockedUntil) expiries.push(limits.blockedUntil.getTime());
  clearTimeout(limits.expiryTimer);
  limits.expiryTimer =
    expiries.length > 0
      ? setTimeout(
          () => {
            recompute(limits);
          },
          Math.min(Math.min(...expiries) - now, MAX_TIMER_MS),
        )
      : undefined;
  listeners.forEach((listener) => {
    listener();
  });
}

export function recordRateLimitHeaders(accountId: AccountId, headers: Headers): void {
  const resource = headers.get("x-ratelimit-resource") ?? "core";
  const limit = Number(headers.get("x-ratelimit-limit"));
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (!TRACKED_RESOURCES.has(resource) || !headers.has("x-ratelimit-limit")) return;
  if (![limit, remaining, reset].every(Number.isFinite)) return;
  recordRateLimit(accountId, resource, { limit, remaining, resetAt: new Date(reset * SECOND_MS) });
}

export function recordRateLimit(accountId: AccountId, resource: string, limit: RateLimit): void {
  const limits = limitsOf(accountId);
  limits.byResource.set(resource, limit);
  recompute(limits);
}

export function recordRateLimitBlock(accountId: AccountId, until: Date): void {
  const limits = limitsOf(accountId);
  if (limits.blockedUntil && limits.blockedUntil >= until) return;
  limits.blockedUntil = until;
  recompute(limits);
}

export function secondaryBackoffMs(accountId: AccountId): number {
  const streak = accounts.get(accountId)?.consecutiveSecondaryLimits ?? 0;
  return SECONDARY_BACKOFF_BASE_MS * 2 ** streak;
}

export function noteSecondaryLimit(accountId: AccountId): void {
  limitsOf(accountId).consecutiveSecondaryLimits++;
}

export function resetSecondaryBackoff(accountId: AccountId): void {
  const limits = accounts.get(accountId);
  if (limits) limits.consecutiveSecondaryLimits = 0;
}

export function subscribeRateLimits(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function lowestRateLimit(accountId: AccountId | null): RateLimit | null {
  return accountId === null ? null : (accounts.get(accountId)?.lowest ?? null);
}

export function rateLimitBlockedUntil(accountId: AccountId | null): Date | null {
  return accountId === null ? null : (accounts.get(accountId)?.blockedUntil ?? null);
}

const LOW_RATE_LIMIT_RATIO = 0.1;

export function isRateLimitLow(limit: RateLimit | null): boolean {
  return limit !== null && ratio(limit) < LOW_RATE_LIMIT_RATIO;
}
