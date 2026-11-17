import type { Page } from "@playwright/test";

export type DatabaseDump = Record<string, Record<string, [unknown, unknown][]>>;

export interface BrowserStateDump {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookie: string;
  indexedDB: DatabaseDump;
  caches: Record<string, Record<string, string>>;
  requestedUrls: string[];
}

export function dumpIndexedDb(page: Page): Promise<DatabaseDump> {
  return page.evaluate(async () => {
    const plain = async (value: unknown): Promise<unknown> => {
      if (value instanceof Date) return value.toISOString();
      if (value instanceof Blob) return value.text();
      if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
      if (ArrayBuffer.isView(value)) return new TextDecoder().decode(value);
      if (value instanceof Map) return plain([...value.entries()]);
      if (value instanceof Set) return plain([...value.values()]);
      if (Array.isArray(value)) return Promise.all(value.map(plain));
      if (typeof value === "bigint") return value.toString();
      if (typeof value !== "object" || value === null) return value;
      const entries = await Promise.all(
        Object.entries(value).map(async ([key, child]) => [key, await plain(child)] as const),
      );
      return Object.fromEntries(entries);
    };
    const settle = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("IndexedDB request failed"));
        };
      });
    const dump: Record<string, Record<string, [unknown, unknown][]>> = {};
    // Opening a missing database creates it.
    for (const { name } of await indexedDB.databases()) {
      if (name === undefined) continue;
      const database = await settle(indexedDB.open(name));
      const stores: Record<string, [unknown, unknown][]> = {};
      for (const storeName of database.objectStoreNames) {
        const store = database.transaction(storeName).objectStore(storeName);
        const keys = await settle(store.getAllKeys());
        const values = await settle(store.getAll());
        stores[storeName] = await Promise.all(
          keys.map(async (key, index) => [await plain(key), await plain(values[index])]),
        );
      }
      database.close();
      dump[name] = stores;
    }
    return dump;
  });
}

export async function dumpBrowserState(page: Page): Promise<BrowserStateDump> {
  const indexedDB = await dumpIndexedDb(page);
  const rest = await page.evaluate(async () => {
    const read = (storage: Storage) =>
      Object.fromEntries(
        Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? "").map(
          (key) => [key, storage.getItem(key) ?? ""],
        ),
      );
    const caches: Record<string, Record<string, string>> = {};
    for (const cacheName of await globalThis.caches.keys()) {
      const cache = await globalThis.caches.open(cacheName);
      const bodies: Record<string, string> = {};
      for (const request of await cache.keys()) {
        bodies[request.url] = (await (await cache.match(request))?.text()) ?? "";
      }
      caches[cacheName] = bodies;
    }
    return {
      localStorage: read(localStorage),
      sessionStorage: read(sessionStorage),
      cookie: document.cookie,
      caches,
      requestedUrls: performance.getEntries().map((entry) => entry.name),
    };
  });
  return { ...rest, indexedDB };
}
