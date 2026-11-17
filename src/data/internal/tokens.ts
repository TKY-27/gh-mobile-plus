import { isGitHubError } from "../errors";
import type { AccountId } from "../session";
import { HTTP_UNAUTHORIZED, MAX_TIMER_MS, MINUTE_MS, SECOND_MS } from "./constants";
import { fetchOrNetworkFailure, gitHubFailure } from "./errors";
import { property, readJson } from "./json";
import { sleep } from "./sleep";
import { deleteAccountStorage, reopenAccountStorage } from "./storage";

export type SignOutReason = "logout" | "reauthRequired" | "rejected";
export type SessionEvent =
  { type: "signedOut"; accountId: AccountId; reason: SignOutReason } | { type: "accountsChanged" };
type ChannelMessage =
  | SessionEvent
  | { type: "token"; accountId: AccountId; accessToken: string; expiresAt: number | null };

interface AccessToken {
  value: string;
  expiresAt: number | null;
  receivedAt: number;
}

const CHANNEL_NAME = "ghm-session";
const REFRESH_AT_LIFETIME_RATIO = 0.8;
const VISIBLE_REFRESH_WINDOW_MS = 15 * MINUTE_MS;
const EXPIRY_MARGIN_MS = MINUTE_MS;
const MIN_REFRESH_DELAY_MS = 30 * SECOND_MS;
const BROADCAST_SETTLE_MS = 250;
const PENDING_LOGOUT_KEY = "ghm-pending-logout";
const RELAY_HEADERS = { "Content-Type": "application/json", "X-GHM-Request": "1" };

// Memory only: never storage, URLs or logs.
const tokens = new Map<AccountId, AccessToken>();
const refreshTimers = new Map<AccountId, ReturnType<typeof setTimeout>>();
const signedOutAccounts = new Set<AccountId>();
const listeners = new Set<(event: SessionEvent) => void>();
const channel = new BroadcastChannel(CHANNEL_NAME);

function lockName(accountId: AccountId): string {
  return `ghm-token-${String(accountId)}`;
}

function isUsable(token: AccessToken): boolean {
  return token.expiresAt === null || token.expiresAt - Date.now() > EXPIRY_MARGIN_MS;
}

function assertSignedIn(accountId: AccountId): void {
  if (signedOutAccounts.has(accountId)) throw gitHubFailure({ kind: "authExpired" });
}

function forgetToken(accountId: AccountId): void {
  tokens.delete(accountId);
  clearTimeout(refreshTimers.get(accountId));
  refreshTimers.delete(accountId);
}

function storeToken(accountId: AccountId, token: AccessToken): void {
  forgetToken(accountId);
  tokens.set(accountId, token);
  if (token.expiresAt === null) return;
  const delay = (token.expiresAt - token.receivedAt) * REFRESH_AT_LIFETIME_RATIO;
  const timer = setTimeout(
    () => {
      refreshInBackground(accountId, token.value);
    },
    Math.min(Math.max(delay, MIN_REFRESH_DELAY_MS), MAX_TIMER_MS),
  );
  refreshTimers.set(accountId, timer);
}

function refreshInBackground(accountId: AccountId, staleValue: string): void {
  refreshAccessToken(accountId, staleValue).catch((error: unknown) => {
    // Keep local sign-out independent of revocation.
    if (isGitHubError(error) && (error.kind === "network" || error.kind === "authExpired")) return;
    reportError(error);
  });
}

function emit(event: SessionEvent): void {
  listeners.forEach((listener) => {
    listener(event);
  });
}

async function applySignOut(accountId: AccountId, reason: SignOutReason): Promise<void> {
  signedOutAccounts.add(accountId);
  forgetToken(accountId);
  const wiping = deleteAccountStorage(accountId);
  emit({ type: "signedOut", accountId, reason });
  await wiping;
}

export async function markAccountSignedOut(
  accountId: AccountId,
  reason: SignOutReason,
): Promise<void> {
  channel.postMessage({ type: "signedOut", accountId, reason } satisfies ChannelMessage);
  await applySignOut(accountId, reason);
}

function relay(path: "/auth/token" | "/auth/logout", accountId: AccountId): Promise<Response> {
  return fetchOrNetworkFailure(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: RELAY_HEADERS,
    body: JSON.stringify({ accountId }),
  });
}

async function requestToken(accountId: AccountId): Promise<AccessToken> {
  const response = await relay("/auth/token", accountId);
  if (response.status === HTTP_UNAUTHORIZED) {
    const reauth = property(await readJson(response), "error") === "reauth_required";
    await markAccountSignedOut(accountId, reauth ? "reauthRequired" : "rejected");
    throw gitHubFailure({ kind: "authExpired" });
  }
  const malformed = gitHubFailure({ kind: "server", status: response.status });
  if (!response.ok) throw malformed;
  const body = await readJson(response);
  const value = property(body, "accessToken");
  const expiresAt = property(body, "expiresAt");
  const validExpiry = expiresAt === null || (typeof expiresAt === "number" && isFinite(expiresAt));
  if (typeof value !== "string" || value === "" || !validExpiry) throw malformed;
  return { value, expiresAt: localExpiry(expiresAt, response), receivedAt: Date.now() };
}

// Server and client clocks can differ.
function localExpiry(expiresAt: number | null, response: Response): number | null {
  if (expiresAt === null) return null;
  const serverNow = Date.parse(response.headers.get("Date") ?? "");
  if (!Number.isFinite(serverNow)) return expiresAt;
  return expiresAt - serverNow + Date.now();
}

export function refreshAccessToken(
  accountId: AccountId,
  staleValue: string | null,
): Promise<string> {
  return navigator.locks.request(lockName(accountId), async () => {
    assertSignedIn(accountId);
    const current = tokens.get(accountId);
    if (current && current.value !== staleValue && isUsable(current)) return current.value;
    const token = await requestToken(accountId);
    assertSignedIn(accountId);
    storeToken(accountId, token);
    channel.postMessage({
      type: "token",
      accountId,
      accessToken: token.value,
      expiresAt: token.expiresAt,
    } satisfies ChannelMessage);
    // Peers adopt it before the next holder.
    await sleep(BROADCAST_SETTLE_MS);
    return token.value;
  });
}

export async function getAccessToken(accountId: AccountId): Promise<string> {
  assertSignedIn(accountId);
  const current = tokens.get(accountId);
  if (current && isUsable(current)) return current.value;
  return refreshAccessToken(accountId, current?.value ?? null);
}

function readPendingLogouts(): AccountId[] {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(PENDING_LOGOUT_KEY) ?? "[]");
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  if (!Array.isArray(stored)) return [];
  return stored.filter((id: unknown): id is AccountId => typeof id === "number");
}

function writePendingLogouts(ids: readonly AccountId[]): void {
  if (ids.length === 0) localStorage.removeItem(PENDING_LOGOUT_KEY);
  else localStorage.setItem(PENDING_LOGOUT_KEY, JSON.stringify([...new Set(ids)]));
}

export function pendingLogouts(): readonly AccountId[] {
  return readPendingLogouts();
}

async function completeLogout(accountId: AccountId): Promise<void> {
  const response = await relay("/auth/logout", accountId);
  if (!response.ok) throw gitHubFailure({ kind: "server", status: response.status });
  writePendingLogouts(readPendingLogouts().filter((id) => id !== accountId));
}

export async function logoutAccount(accountId: AccountId): Promise<void> {
  writePendingLogouts([...readPendingLogouts(), accountId]);
  await navigator.locks.request(lockName(accountId), async () => {
    await markAccountSignedOut(accountId, "logout");
    await completeLogout(accountId);
  });
}

export async function retryPendingLogouts(): Promise<void> {
  for (const accountId of readPendingLogouts()) {
    signedOutAccounts.add(accountId);
    try {
      await navigator.locks.request(lockName(accountId), () => completeLogout(accountId));
    } catch (error) {
      if (!isGitHubError(error) || error.kind !== "network") reportError(error);
    }
  }
}

export function reopenAccount(accountId: AccountId): void {
  signedOutAccounts.delete(accountId);
  reopenAccountStorage(accountId);
}

export function tokenLifetime(
  accountId: AccountId,
): { expiring: boolean; remainingMs: number | null } | null {
  const token = tokens.get(accountId);
  if (!token) return null;
  return {
    expiring: token.expiresAt !== null,
    remainingMs: token.expiresAt === null ? null : token.expiresAt - Date.now(),
  };
}

export function broadcastAccountsChanged(): void {
  channel.postMessage({ type: "accountsChanged" } satisfies ChannelMessage);
}

export function subscribeSessionEvents(listener: (event: SessionEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isSignOutReason(value: unknown): value is SignOutReason {
  return value === "logout" || value === "reauthRequired" || value === "rejected";
}

function parseChannelMessage(message: unknown): ChannelMessage | null {
  const type = property(message, "type");
  const accountId = property(message, "accountId");
  if (type === "accountsChanged") return { type };
  if (typeof accountId !== "number") return null;
  const reason = property(message, "reason");
  if (type === "signedOut" && isSignOutReason(reason)) return { type, accountId, reason };
  const accessToken = property(message, "accessToken");
  const expiresAt = property(message, "expiresAt");
  if (
    type === "token" &&
    typeof accessToken === "string" &&
    (expiresAt === null || typeof expiresAt === "number")
  ) {
    return { type, accountId, accessToken, expiresAt };
  }
  return null;
}

function adoptBroadcastToken(accountId: AccountId, value: string, expiresAt: number | null): void {
  if (signedOutAccounts.has(accountId)) return;
  const currentExpiry = tokens.get(accountId)?.expiresAt ?? null;
  // Crossed broadcasts must not downgrade tokens.
  if (currentExpiry !== null && expiresAt !== null && expiresAt < currentExpiry) return;
  storeToken(accountId, { value, expiresAt, receivedAt: Date.now() });
}

channel.onmessage = (event: MessageEvent<unknown>) => {
  const message = parseChannelMessage(event.data);
  switch (message?.type) {
    case "token":
      adoptBroadcastToken(message.accountId, message.accessToken, message.expiresAt);
      break;
    case "signedOut":
      applySignOut(message.accountId, message.reason).catch(reportError);
      break;
    case "accountsChanged":
      emit(message);
      break;
    case undefined:
      break;
  }
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  for (const [accountId, token] of tokens) {
    const remaining = token.expiresAt === null ? Infinity : token.expiresAt - Date.now();
    if (remaining < VISIBLE_REFRESH_WINDOW_MS) refreshInBackground(accountId, token.value);
  }
});
