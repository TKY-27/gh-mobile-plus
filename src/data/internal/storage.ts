import type { AccountId } from "../session";

export type AccountDatabase = "cache" | "drafts";

const STORE = "entries";
const DATABASE_VERSION = 1;
const ACCOUNT_DATABASES: readonly AccountDatabase[] = ["cache", "drafts"];

const closedAccounts = new Set<AccountId>();

function accountDatabaseName(kind: AccountDatabase, accountId: AccountId): string {
  return `ghm-${kind}-${String(accountId)}`;
}

function settle(request: IDBRequest | IDBOpenDBRequest, label: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error(`IndexedDB ${label} failed`));
    };
  });
}

async function withStore<T>(
  kind: AccountDatabase,
  accountId: AccountId,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const open = indexedDB.open(accountDatabaseName(kind, accountId), DATABASE_VERSION);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(STORE);
  };
  await settle(open, "open");
  const database = open.result;
  try {
    const transaction = database.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      };
    });
    await done;
    return request.result;
  } finally {
    database.close();
  }
}

// Any access would recreate a deleted database.
export async function readEntry(
  kind: AccountDatabase,
  accountId: AccountId,
  key: string,
): Promise<unknown> {
  if (closedAccounts.has(accountId)) return undefined;
  return withStore(kind, accountId, "readonly", (store) => store.get(key));
}

export async function writeEntry(
  kind: AccountDatabase,
  accountId: AccountId,
  key: string,
  value: unknown,
): Promise<void> {
  if (closedAccounts.has(accountId)) return;
  await withStore(kind, accountId, "readwrite", (store) => store.put(value, key));
}

export async function deleteEntry(
  kind: AccountDatabase,
  accountId: AccountId,
  key: string,
): Promise<void> {
  if (closedAccounts.has(accountId)) return;
  await withStore(kind, accountId, "readwrite", (store) => store.delete(key));
}

export const RECENT_SEARCHES_KEY_PREFIX = "ghm-recent-searches-";

/** Closed first; pending writes cannot recreate it. */
export async function deleteAccountStorage(accountId: AccountId): Promise<void> {
  closedAccounts.add(accountId);
  localStorage.removeItem(RECENT_SEARCHES_KEY_PREFIX + String(accountId));
  await Promise.all(
    ACCOUNT_DATABASES.map((kind) =>
      settle(indexedDB.deleteDatabase(accountDatabaseName(kind, accountId)), "delete"),
    ),
  );
}

const ACCOUNT_DATABASE_NAME = /^ghm-(?:cache|drafts)-(\d+)$/;
const RECENT_SEARCHES_KEY = new RegExp(`^${RECENT_SEARCHES_KEY_PREFIX}(\\d+)$`);

function accountIdIn(name: string, pattern: RegExp): AccountId[] {
  const accountId = Number(pattern.exec(name)?.[1]);
  return Number.isSafeInteger(accountId) ? [accountId] : [];
}

// Accounts can vanish while no tab runs.
export async function deleteOrphanedAccountStorage(keep: ReadonlySet<AccountId>): Promise<void> {
  const databases = "databases" in indexedDB ? await indexedDB.databases() : [];
  const storageKeys = Array.from(
    { length: localStorage.length },
    (_, index) => localStorage.key(index) ?? "",
  );
  const owners = [
    ...databases.flatMap((database) => accountIdIn(database.name ?? "", ACCOUNT_DATABASE_NAME)),
    ...storageKeys.flatMap((key) => accountIdIn(key, RECENT_SEARCHES_KEY)),
  ];
  const orphans = new Set(owners.filter((accountId) => !keep.has(accountId)));
  await Promise.all([...orphans].map(deleteAccountStorage));
}

export function reopenAccountStorage(accountId: AccountId): void {
  closedAccounts.delete(accountId);
}
