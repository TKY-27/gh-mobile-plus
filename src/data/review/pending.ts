import { useCallback, useMemo, useSyncExternalStore } from "react";
import { draftKeys } from "../drafts";
import { property } from "../internal/json";
import { readEntry } from "../internal/storage";
import { subscribeSessionEvents } from "../internal/tokens";
import { useActiveAccount, type AccountId } from "../session";
import type { DiffSide } from "./patch";

export interface PendingComment {
  id: string;
  commitOid?: string;
  baseOid?: string;
  pendingReviewId?: string;
  previousMatches?: number;
  path: string;
  line: number;
  side: DiffSide;
  startLine?: number;
  startSide?: DiffSide;
  body: string;
}

export interface PendingReview {
  comments: readonly PendingComment[];
  add(
    comment: Omit<PendingComment, "id" | "pendingReviewId" | "previousMatches"> & {
      commitOid: string;
      baseOid: string;
    },
  ): void;
  restore(comment: PendingComment): void;
  update(
    id: string,
    body: string,
    originalBody: string,
  ): Promise<{ saved: PendingComment; latestBody?: string } | null>;
  remove(id: string): void;
  isLoaded: boolean;
  error: Error | null;
}

interface PendingState {
  comments: readonly PendingComment[];
  isLoaded: boolean;
  error: Error | null;
}

interface PendingDraft {
  state: PendingState;
  queued: Promise<void>;
  unsaved: CommentsChange[];
  listeners: Set<() => void>;
}

type CommentsChange = (comments: readonly PendingComment[]) => readonly PendingComment[];

const NOT_LOADED: PendingState = { comments: [], isLoaded: false, error: null };
const MALFORMED_DRAFTS = "Some stored review comments were unreadable";
const DRAFTS_DATABASE_PREFIX = "ghm-drafts-";
const DRAFTS_STORE = "entries";
const reviewChanges = new BroadcastChannel("ghm-pending-review");

const pendingDrafts = new Map<string, PendingDraft>();

subscribeSessionEvents((event) => {
  if (event.type !== "signedOut") return;
  const prefix = `${String(event.accountId)} `;
  for (const [scope, draft] of pendingDrafts) {
    if (!scope.startsWith(prefix)) continue;
    pendingDrafts.delete(scope);
    draft.unsaved.length = 0;
    publish(draft, NOT_LOADED);
  }
});

function scopeOf(accountId: AccountId, key: string): string {
  return `${String(accountId)} ${key}`;
}

export function withPendingReviewLock<T>(
  accountId: AccountId,
  key: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  const scope = scopeOf(accountId, key.toLowerCase());
  return navigator.locks.request(`ghm-pending-review ${scope}`, operation);
}

function asError(error: unknown): Error {
  return error instanceof Error || error instanceof DOMException ? error : new Error(String(error));
}

function isSide(value: unknown): value is DiffSide {
  return value === "LEFT" || value === "RIGHT";
}

function isOptional(value: unknown, check: (present: unknown) => boolean): boolean {
  return value === undefined || check(value);
}

function isPendingComment(value: unknown): value is PendingComment {
  return (
    typeof property(value, "id") === "string" &&
    isOptional(property(value, "commitOid"), (oid) => typeof oid === "string") &&
    isOptional(property(value, "baseOid"), (oid) => typeof oid === "string") &&
    isOptional(property(value, "pendingReviewId"), (id) => typeof id === "string") &&
    isOptional(property(value, "previousMatches"), Number.isInteger) &&
    typeof property(value, "path") === "string" &&
    typeof property(value, "body") === "string" &&
    Number.isInteger(property(value, "line")) &&
    isSide(property(value, "side")) &&
    isOptional(property(value, "startLine"), Number.isInteger) &&
    isOptional(property(value, "startSide"), isSide)
  );
}

function publish(draft: PendingDraft, state: PendingState): void {
  draft.state = state;
  for (const listener of draft.listeners) listener();
}

function pendingDraft(accountId: AccountId, key: string): PendingDraft {
  const scope = scopeOf(accountId, key);
  const existing = pendingDrafts.get(scope);
  if (existing) return existing;
  const draft: PendingDraft = {
    state: NOT_LOADED,
    queued: Promise.resolve(),
    unsaved: [],
    listeners: new Set(),
  };
  pendingDrafts.set(scope, draft);
  return draft;
}

function storedState(stored: unknown): PendingState {
  const entries: unknown[] = Array.isArray(stored) ? stored : [];
  const comments = entries.filter(isPendingComment);
  const intact =
    stored === undefined || (Array.isArray(stored) && comments.length === entries.length);
  return { comments, isLoaded: true, error: intact ? null : new Error(MALFORMED_DRAFTS) };
}

function queueDraft<T>(draft: PendingDraft, operation: () => Promise<T>): Promise<T> {
  const result = draft.queued.then(async () => {
    try {
      return await operation();
    } catch (error) {
      publish(draft, { ...draft.state, error: asError(error) });
      throw error;
    }
  });
  draft.queued = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function ensureOpen(accountId: AccountId, key: string, draft: PendingDraft): void {
  if (pendingDrafts.get(scopeOf(accountId, key)) !== draft) {
    throw new Error("Pending review draft closed");
  }
}

function publishStored(draft: PendingDraft, stored: PendingState): void {
  publish(draft, {
    ...stored,
    comments: draft.unsaved.reduce((comments, change) => change(comments), stored.comments),
    error: draft.unsaved.length ? (draft.state.error ?? stored.error) : stored.error,
  });
}

async function loadDraft(
  accountId: AccountId,
  key: string,
  draft: PendingDraft,
): Promise<readonly PendingComment[]> {
  ensureOpen(accountId, key, draft);
  const stored = storedState(await readEntry("drafts", accountId, key));
  ensureOpen(accountId, key, draft);
  publishStored(draft, stored);
  return stored.comments;
}

function openDraftDatabase(accountId: AccountId): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(`${DRAFTS_DATABASE_PREFIX}${String(accountId)}`);
    // A queued edit cannot recreate deleted storage.
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onsuccess = () => {
      resolve(open.result);
    };
    open.onerror = () => {
      reject(open.error ?? new Error("IndexedDB open failed"));
    };
  });
}

async function persistChange(
  accountId: AccountId,
  key: string,
  draft: PendingDraft,
  change: CommentsChange,
): Promise<readonly PendingComment[]> {
  if (!draft.state.isLoaded) await loadDraft(accountId, key, draft);
  ensureOpen(accountId, key, draft);
  const database = await openDraftDatabase(accountId);
  try {
    ensureOpen(accountId, key, draft);
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DRAFTS_STORE, "readwrite");
      const store = transaction.objectStore(DRAFTS_STORE);
      const read = store.get(key);
      let updated: readonly PendingComment[] = [];
      let failure: Error | undefined;
      read.onsuccess = () => {
        try {
          updated = change(storedState(read.result).comments);
          if (updated.length === 0) store.delete(key);
          else store.put(updated, key);
        } catch (error) {
          failure = asError(error);
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        resolve(updated);
      };
      transaction.onabort = () => {
        reject(failure ?? transaction.error ?? new Error("IndexedDB transaction aborted"));
      };
    });
  } finally {
    database.close();
  }
}

function publishCommit(
  accountId: AccountId,
  key: string,
  draft: PendingDraft,
  comments: readonly PendingComment[],
): void {
  ensureOpen(accountId, key, draft);
  publishStored(draft, { comments, isLoaded: true, error: null });
  reviewChanges.postMessage({ accountId, key });
}

async function flushLocalChanges(accountId: AccountId, key: string, draft: PendingDraft) {
  for (let change = draft.unsaved[0]; change; change = draft.unsaved[0]) {
    const comments = await persistChange(accountId, key, draft, change);
    draft.unsaved.shift();
    publishCommit(accountId, key, draft, comments);
  }
}

export async function readPendingComments(
  accountId: AccountId,
  key: string,
): Promise<readonly PendingComment[]> {
  const draft = pendingDraft(accountId, key);
  return queueDraft(draft, async () => {
    await flushLocalChanges(accountId, key, draft);
    return loadDraft(accountId, key, draft);
  });
}

export async function changePendingComments(
  accountId: AccountId,
  key: string,
  change: CommentsChange,
): Promise<readonly PendingComment[]> {
  const draft = pendingDraft(accountId, key);
  return queueDraft(draft, async () => {
    await flushLocalChanges(accountId, key, draft);
    const comments = await persistChange(accountId, key, draft, change);
    publishCommit(accountId, key, draft, comments);
    return comments;
  });
}

reviewChanges.onmessage = (event: MessageEvent<unknown>) => {
  const accountId = property(event.data, "accountId");
  const key = property(event.data, "key");
  if (typeof accountId !== "number" || typeof key !== "string") return;
  const draft = pendingDrafts.get(scopeOf(accountId, key));
  if (!draft?.listeners.size) return;
  // Failures surface through `error`.
  queueDraft(draft, () => loadDraft(accountId, key, draft)).catch(() => undefined);
};

export function usePendingReview(owner: string, repo: string, number: number): PendingReview {
  const accountId = useActiveAccount().id;
  const key = draftKeys.pendingReview(owner, repo, number);
  const subscribe = useCallback(
    (listener: () => void) => {
      const draft = pendingDraft(accountId, key);
      draft.listeners.add(listener);
      // Failures surface through `error`.
      if (draft.listeners.size === 1) {
        queueDraft(draft, () => loadDraft(accountId, key, draft)).catch(() => undefined);
      }
      return () => {
        draft.listeners.delete(listener);
      };
    },
    [accountId, key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => pendingDrafts.get(scopeOf(accountId, key))?.state ?? NOT_LOADED,
  );
  return useMemo(() => {
    const change = (update: CommentsChange): void => {
      const draft = pendingDraft(accountId, key);
      draft.unsaved.push(update);
      publish(draft, { ...draft.state, comments: update(draft.state.comments) });
      // Failures surface through `error`.
      queueDraft(draft, () => flushLocalChanges(accountId, key, draft)).catch(() => undefined);
    };
    return {
      comments: state.comments,
      isLoaded: state.isLoaded,
      error: state.error,
      add: (comment) => {
        const created = { ...comment, id: crypto.randomUUID() };
        change((comments) => [...comments, created]);
      },
      restore: (comment) => {
        change((comments) =>
          comments.some(({ id }) => id === comment.id) ? comments : [...comments, comment],
        );
      },
      update: async (id, body, originalBody) => {
        const copyId = crypto.randomUUID();
        const committed = await changePendingComments(accountId, key, (comments) => {
          const latest = comments.find((entry) => entry.id === id);
          if (!latest || latest.pendingReviewId || latest.body === body) return comments;
          if (latest.body !== originalBody) return [...comments, { ...latest, id: copyId, body }];
          return comments.map((entry) => (entry === latest ? { ...latest, body } : entry));
        });
        const latest = committed.find((entry) => entry.id === id);
        if (!latest || latest.pendingReviewId) return null;
        const copy = committed.find((entry) => entry.id === copyId);
        return copy ? { saved: copy, latestBody: latest.body } : { saved: latest };
      },
      remove: (id) => {
        change((comments) =>
          comments.filter((entry) => entry.id !== id || !!entry.pendingReviewId),
        );
      },
    };
  }, [accountId, key, state]);
}
