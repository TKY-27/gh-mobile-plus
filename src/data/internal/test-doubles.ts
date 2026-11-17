import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";

class MemoryStorage implements Storage {
  [name: string]: unknown;
  readonly #items = new Map<string, string>();
  get length(): number {
    return this.#items.size;
  }
  clear(): void {
    this.#items.clear();
  }
  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}

export class MemoryLocks {
  readonly #tails = new Map<string, Promise<unknown>>();
  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const result = (this.#tails.get(name) ?? Promise.resolve()).then(callback);
    this.#tails.set(
      name,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}

// Node's disabled localStorage shadows jsdom's.
export function installBrowserDoubles(): { locks: MemoryLocks } {
  const locks = new MemoryLocks();
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("indexedDB", new IDBFactory());
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  return { locks };
}

async function databaseContents(name: string): Promise<string> {
  const open = indexedDB.open(name);
  await new Promise((resolve, reject) => {
    open.onsuccess = resolve;
    open.onerror = () => {
      reject(open.error ?? new Error("open failed"));
    };
  });
  const database = open.result;
  const stores = [...database.objectStoreNames];
  const values = await Promise.all(
    stores.map(
      (store) =>
        new Promise<unknown>((resolve, reject) => {
          const request = database.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(request.error ?? new Error("read failed"));
          };
        }),
    ),
  );
  database.close();
  return JSON.stringify(values);
}

export async function databaseNames(): Promise<string[]> {
  const databases = await indexedDB.databases();
  return databases.flatMap((database) => database.name ?? []).sort();
}

export async function persistedText(): Promise<string> {
  const names = await databaseNames();
  const databases = await Promise.all(names.map(databaseContents));
  const storages = [localStorage, sessionStorage].map((storage) =>
    JSON.stringify(
      Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? "";
        return [key, storage.getItem(key)];
      }),
    ),
  );
  return [...databases, ...storages].join("\n");
}
