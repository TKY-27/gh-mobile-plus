import { defaultShouldDehydrateQuery, type Query } from "@tanstack/react-query";
import type {
  PersistedClient,
  PersistQueryClientOptions,
  Persister,
} from "@tanstack/react-query-persist-client";
import { readPreferences } from "../preferences";
import type { AccountId } from "../session";
import type { UserProfile } from "../users";
import { DAY_MS } from "./constants";
import { isJsonObject, property } from "./json";
import type { PersistenceMeta } from "./query";
import { deleteEntry, readEntry, writeEntry } from "./storage";

export const CACHE_MAX_AGE_MS = 7 * DAY_MS;
// Older entity shapes may hydrate incorrectly.
export const CACHE_BUSTER = "data-v1";
const CLIENT_KEY = "client";
const PERSIST_THROTTLE_MS = 1000;
const CACHE_DATABASE_PREFIX = "ghm-cache-";
const PREFERENCES_KEY = "ghm-preferences";
const PROFILE_FIELDS = [
  "login",
  "name",
  "avatarUrl",
  "bio",
  "company",
  "location",
  "websiteUrl",
  "followers",
  "following",
  "isViewer",
  "viewerIsFollowing",
  "isOrganization",
] as const satisfies readonly (keyof UserProfile)[];

interface QueryFacts {
  meta?: PersistenceMeta | undefined;
  state: { dataUpdatedAt: number };
}

function isStorable(query: QueryFacts, keepPrivateOffline: boolean): boolean {
  const fresh = query.state.dataUpdatedAt > Date.now() - CACHE_MAX_AGE_MS;
  const classification = query.meta?.persist;
  return (
    fresh &&
    classification !== "never" &&
    (keepPrivateOffline || classification === "profile" || classification === "user-search")
  );
}

export function shouldPersistQuery(query: Query, keepPrivateOffline: boolean): boolean {
  return defaultShouldDehydrateQuery(query) && isStorable(query, keepPrivateOffline);
}

function isPersistedClient(value: unknown): value is PersistedClient {
  const clientState = property(value, "clientState");
  const queries = property(clientState, "queries");
  return (
    typeof property(value, "timestamp") === "number" &&
    typeof property(value, "buster") === "string" &&
    Array.isArray(queries) &&
    queries.every(
      (query: unknown) => typeof property(property(query, "state"), "dataUpdatedAt") === "number",
    ) &&
    Array.isArray(property(clientState, "mutations"))
  );
}

function storableClient(client: PersistedClient, keepPrivateOffline: boolean): PersistedClient {
  const queries = client.clientState.queries.flatMap((query) => {
    if (!isStorable(query, keepPrivateOffline)) return [];
    if (keepPrivateOffline || query.meta?.persist !== "profile") return [query];
    const profile = query.state.data;
    if (!isJsonObject(profile)) return [];
    const basics = Object.fromEntries(PROFILE_FIELDS.map((field) => [field, profile[field]]));
    return [
      {
        ...query,
        state: {
          ...query.state,
          data: { ...basics, readmeHtml: null, pinned: [] },
          // Refresh omitted sections when online.
          isInvalidated: true,
        },
      },
    ];
  });
  const mutations = keepPrivateOffline ? client.clientState.mutations : [];
  return { ...client, clientState: { mutations, queries } };
}

function lockCache(accountId: AccountId, update: () => Promise<void>): Promise<void> {
  return navigator.locks.request(CACHE_DATABASE_PREFIX + String(accountId), update);
}

function readOfflineCachePreference(): boolean {
  // A peer's storage event can lag.
  const stored = localStorage.getItem(PREFERENCES_KEY);
  if (stored !== null) {
    try {
      const keepPrivateOffline = property(JSON.parse(stored), "keepPrivateOffline");
      if (typeof keepPrivateOffline === "boolean") return keepPrivateOffline;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return readPreferences().keepPrivateOffline;
}

export function createCachePersister(accountId: AccountId): Persister {
  let pending: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    timer = undefined;
    const client = pending;
    pending = null;
    if (!client) return;
    lockCache(accountId, () =>
      writeEntry(
        "cache",
        accountId,
        CLIENT_KEY,
        storableClient(client, readOfflineCachePreference()),
      ),
    ).catch(reportError);
  };
  return {
    persistClient(client) {
      pending = client;
      timer ??= setTimeout(flush, PERSIST_THROTTLE_MS);
    },
    async restoreClient() {
      const stored = await readEntry("cache", accountId, CLIENT_KEY);
      if (stored === undefined) return undefined;
      if (!isPersistedClient(stored)) throw new Error("Malformed persisted query cache");
      return storableClient(stored, readOfflineCachePreference());
    },
    async removeClient() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
      await lockCache(accountId, () => deleteEntry("cache", accountId, CLIENT_KEY));
    },
  };
}

export function cachePersistOptions(
  persister: Persister,
): Omit<PersistQueryClientOptions, "queryClient"> {
  return {
    persister,
    maxAge: CACHE_MAX_AGE_MS,
    buster: CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        shouldPersistQuery(query, readPreferences().keepPrivateOffline),
      shouldDehydrateMutation: () => false,
    },
  };
}

async function storedCacheOwners(): Promise<ReadonlySet<AccountId> | null> {
  if (!("databases" in indexedDB)) return null;
  const databases = await indexedDB.databases();
  return new Set(
    databases.flatMap(({ name }) => {
      if (!name?.startsWith(CACHE_DATABASE_PREFIX)) return [];
      const id = Number(name.slice(CACHE_DATABASE_PREFIX.length));
      return Number.isSafeInteger(id) && id > 0 ? [id] : [];
    }),
  );
}

export async function rewriteStoredCaches(knownAccountIds: readonly AccountId[]): Promise<void> {
  const discovered = await storedCacheOwners();
  const accountIds = new Set([...knownAccountIds, ...(discovered ?? [])]);
  await Promise.all(
    [...accountIds].map((accountId) =>
      lockCache(accountId, async () => {
        // A pending write can create the cache.
        if (discovered && !discovered.has(accountId)) {
          const current = await storedCacheOwners();
          if (!current?.has(accountId)) return;
        }
        const stored = await readEntry("cache", accountId, CLIENT_KEY);
        if (stored === undefined) return;
        if (!isPersistedClient(stored)) {
          await deleteEntry("cache", accountId, CLIENT_KEY);
          return;
        }
        await writeEntry("cache", accountId, CLIENT_KEY, storableClient(stored, false));
      }),
    ),
  );
}
