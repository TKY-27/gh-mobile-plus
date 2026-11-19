import { onlineManager, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, useState, useSyncExternalStore, type JSX, type ReactNode } from "react";
import { isGitHubError, rememberOAuthClientId } from "./errors";
import { property, readJson } from "./internal/json";
import {
  CACHE_MAX_AGE_MS,
  cachePersistOptions,
  createCachePersister,
  rewriteStoredCaches,
} from "./internal/persistence";
import { rateLimitBlockedUntil } from "./internal/rate-limit";
import { deleteOrphanedAccountStorage } from "./internal/storage";
import {
  broadcastAccountsChanged,
  logoutAccount,
  markAccountSignedOut,
  pendingLogouts,
  reopenAccount,
  retryPendingLogouts,
  subscribeSessionEvents,
  type SessionEvent,
} from "./internal/tokens";
import { usePreferences } from "./preferences";

export type AccountId = number;
export const MAX_ACCOUNTS = 5;
export interface Account {
  id: AccountId;
  login: string;
  avatarUrl: string;
  publicOnly: boolean;
  status: "active" | "signedOut";
}
export interface Session {
  status: "loading" | "signedOut" | "ready";
  accounts: readonly Account[];
  activeAccount: Account | null;
}
export type SignInErrorCode =
  "state_mismatch" | "access_denied" | "exchange_failed" | "org_restricted" | "account_limit";

const ACTIVE_ACCOUNT_KEY = "ghm-active-account";
// Non-secret profiles let offline cold starts render.
const ACCOUNT_SNAPSHOT_KEY = "ghm-accounts";
const CLIENT_ID_HEADER = "X-GHM-Client-Id";
const MAX_QUERY_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;
const SIGN_IN_ERRORS: readonly SignInErrorCode[] = [
  "state_mismatch",
  "access_denied",
  "exchange_failed",
  "org_restricted",
  "account_limit",
];

let session: Session = { status: "loading", accounts: [], activeAccount: null };
// Prevent stale responses from replacing account state.
let generation = 0;
const listeners = new Set<() => void>();

export function profileEditorAccountId(
  location: Pick<URL, "pathname" | "search">,
): AccountId | null {
  if (location.pathname !== "/account") return null;
  const accountId = Number(new URLSearchParams(location.search).get("editProfile"));
  return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null;
}

function storedActiveAccountId(): AccountId | null {
  const stored = Number(localStorage.getItem(ACTIVE_ACCOUNT_KEY));
  return Number.isSafeInteger(stored) && stored > 0 ? stored : null;
}

function parseAccount(entry: unknown): Account | null {
  const id = property(entry, "id");
  const login = property(entry, "login");
  const avatarUrl = property(entry, "avatarUrl");
  const publicOnly = property(entry, "publicOnly");
  if (typeof id !== "number" || typeof login !== "string") return null;
  if (typeof avatarUrl !== "string" || typeof publicOnly !== "boolean") return null;
  return { id, login, avatarUrl, publicOnly, status: "active" };
}

function parseAccounts(body: unknown): Account[] | null {
  if (!Array.isArray(body)) return null;
  const accounts = body.map(parseAccount);
  return accounts.every((account) => account !== null) ? accounts : null;
}

// Keep sign-in available after snapshot corruption.
function readSnapshot(): Account[] {
  const stored = localStorage.getItem(ACCOUNT_SNAPSHOT_KEY);
  if (stored === null) return [];
  try {
    return parseAccounts(JSON.parse(stored)) ?? [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function commit(accounts: readonly Account[], preferredId: AccountId | null): void {
  const activeAccount =
    accounts.find((account) => account.id === preferredId) ??
    accounts.find((account) => account.status === "active") ??
    accounts[0] ??
    null;
  if (activeAccount) localStorage.setItem(ACTIVE_ACCOUNT_KEY, String(activeAccount.id));
  else localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
  const snapshot = accounts
    .filter((account) => account.status === "active")
    .map(({ id, login, avatarUrl, publicOnly }) => ({ id, login, avatarUrl, publicOnly }));
  localStorage.setItem(ACCOUNT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  session = { status: activeAccount ? "ready" : "signedOut", accounts, activeAccount };
  listeners.forEach((listener) => {
    listener();
  });
}

function currentPreferredId(): AccountId | null {
  return session.activeAccount?.id ?? storedActiveAccountId();
}

async function fetchAccountList(): Promise<Account[]> {
  const response = await fetch("/auth/accounts", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`Account list failed with ${String(response.status)}`);
  rememberOAuthClientId(response.headers.get(CLIENT_ID_HEADER));
  const listed = parseAccounts(await readJson(response));
  if (!listed) throw new Error("Malformed account list");
  return listed;
}

async function loadAccounts(): Promise<void> {
  await retryPendingLogouts();
  const started = generation;
  const listed = await fetchAccountList();
  if (generation !== started) return loadAccounts();
  const pending = new Set(pendingLogouts());
  const signedIn = listed.filter((account) => !pending.has(account.id));
  const signedInIds = new Set(signedIn.map((account) => account.id));
  const known = session.status === "loading" ? readSnapshot() : session.accounts;
  const removed = known.filter(
    (account) => account.status === "active" && !signedInIds.has(account.id),
  );
  const stillSignedOut = known.filter(
    (account) => account.status === "signedOut" && !signedInIds.has(account.id),
  );
  signedIn.forEach((account) => {
    reopenAccount(account.id);
  });
  const returning = session.status === "loading" ? profileEditorAccountId(window.location) : null;
  const preferred =
    returning !== null && signedInIds.has(returning) ? returning : currentPreferredId();
  commit([...signedIn, ...stillSignedOut], preferred);
  await Promise.all(removed.map((account) => markAccountSignedOut(account.id, "logout")));
  await deleteOrphanedAccountStorage(new Set([...signedInIds, ...pending]));
}

async function refreshAccounts(): Promise<void> {
  try {
    await loadAccounts();
  } catch (error) {
    // Offline is expected.
    if (!(error instanceof TypeError)) reportError(error);
    if (session.status !== "loading") return;
    const pending = new Set(pendingLogouts());
    const snapshot = readSnapshot().filter((account) => !pending.has(account.id));
    commit(snapshot, storedActiveAccountId());
  }
}

function applySessionEvent(event: SessionEvent): void {
  generation++;
  if (event.type === "accountsChanged") {
    void refreshAccounts();
    return;
  }
  const { accountId } = event;
  if (event.reason === "logout") {
    const remaining = session.accounts.filter((account) => account.id !== accountId);
    const preferred = currentPreferredId();
    commit(remaining, preferred === accountId ? null : preferred);
    return;
  }
  const accounts = session.accounts.map((account) =>
    account.id === accountId ? { ...account, status: "signedOut" as const } : account,
  );
  commit(accounts, currentPreferredId());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readSession(): Session {
  return session;
}

function createQueryClient(accountId: AccountId): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: CACHE_MAX_AGE_MS,
        networkMode: "offlineFirst",
        retry: (failureCount, error) =>
          failureCount < MAX_QUERY_RETRIES &&
          isGitHubError(error) &&
          (error.kind === "network" || error.kind === "server"),
        retryDelay: (failureCount) => {
          const backoff = Math.min(BASE_RETRY_DELAY_MS * 2 ** failureCount, MAX_RETRY_DELAY_MS);
          const blockedMs = (rateLimitBlockedUntil(accountId)?.getTime() ?? 0) - Date.now();
          return Math.max(backoff, blockedMs);
        },
      },
      mutations: { networkMode: "always", retry: false },
    },
  });
}

function AccountCache(props: { accountId: AccountId; children: ReactNode }): JSX.Element {
  const [queryClient] = useState(() => createQueryClient(props.accountId));
  const [persister] = useState(() => createCachePersister(props.accountId));
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={cachePersistOptions(persister)}
    >
      {props.children}
    </PersistQueryClientProvider>
  );
}

export function SessionProvider(props: { children: ReactNode }): JSX.Element {
  const current = useSession();
  const { keepPrivateOffline } = usePreferences();
  useEffect(() => {
    if (keepPrivateOffline) return;
    const accountIds = [...session.accounts, ...readSnapshot()].map((account) => account.id);
    rewriteStoredCaches(accountIds).catch(reportError);
  }, [keepPrivateOffline]);
  useEffect(() => {
    if (!navigator.onLine) onlineManager.setOnline(false);
    const unsubscribe = subscribeSessionEvents(applySessionEvent);
    const retryWhenOnline = (): void => {
      void refreshAccounts();
    };
    window.addEventListener("online", retryWhenOnline);
    void refreshAccounts().then(broadcastAccountsChanged);
    return () => {
      unsubscribe();
      window.removeEventListener("online", retryWhenOnline);
    };
  }, []);
  const active = current.activeAccount;
  if (!active) return <>{props.children}</>;
  const wiped = active.status === "signedOut";
  return (
    <AccountCache key={`${String(active.id)}:${String(wiped)}`} accountId={active.id}>
      {props.children}
    </AccountCache>
  );
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, readSession);
}

export function useActiveAccount(): Account {
  const account = useSession().activeAccount;
  if (!account) throw new Error("useActiveAccount requires an active account");
  return account;
}

export function switchAccount(id: AccountId): void {
  if (!session.accounts.some((account) => account.id === id)) {
    throw new Error("Cannot switch to an unknown account");
  }
  commit(session.accounts, id);
}

export async function signOut(id: AccountId): Promise<void> {
  await logoutAccount(id);
}

export async function signOutAll(): Promise<void> {
  const results = await Promise.allSettled(
    session.accounts.map((account) => logoutAccount(account.id)),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

export function signInHref(options: {
  mode: "add" | "reauth" | "profile";
  accountId?: AccountId;
  publicOnly: boolean;
}): string {
  const params = new URLSearchParams({
    mode: options.mode,
    public: options.publicOnly ? "1" : "0",
  });
  if (options.accountId !== undefined) params.set("account", String(options.accountId));
  return `/auth/login?${params.toString()}`;
}

export function parseSignInError(search: string): SignInErrorCode | null {
  const code = new URLSearchParams(search).get("error");
  return SIGN_IN_ERRORS.find((known) => known === code) ?? null;
}
