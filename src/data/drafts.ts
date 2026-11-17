import { useCallback, useEffect, useRef, useState } from "react";
import { property } from "./internal/json";
import { deleteEntry, readEntry, writeEntry } from "./internal/storage";
import { useActiveAccount, type AccountId } from "./session";

const DRAFT_SAVE_DELAY_MS = 500;
const DRAFT_FORMAT_VERSION = 1;

export const draftKeys = {
  comment: (owner: string, repo: string, number: number): string =>
    `comment:${owner}/${repo}#${String(number)}`,
  newIssue: (owner: string, repo: string): string => `issue:${owner}/${repo}`,
  fileEdit: (owner: string, repo: string, ref: string, path: string): string =>
    `file:${JSON.stringify([owner, repo, ref, path])}`,
  pendingReview: (owner: string, repo: string, number: number): string =>
    `review:${owner}/${repo}#${String(number)}`,
};

interface PendingDraft {
  accountId: AccountId;
  key: string;
  value: unknown;
}

function sameShape(value: unknown, initial: unknown): boolean {
  return typeof value === typeof initial && Array.isArray(value) === Array.isArray(initial);
}

function restoreDraft<T>(stored: unknown, initial: T): T | undefined {
  if (property(stored, "version") !== DRAFT_FORMAT_VERSION) return undefined;
  const value = property(stored, "value");
  return sameShape(value, initial) ? (value as T) : undefined;
}

export function useDraft<T>(
  key: string,
  initial: T,
): readonly [value: T, set: (next: T) => void, clear: () => void, isLoaded: boolean] {
  const accountId = useActiveAccount().id;
  const scope = `${String(accountId)}:${key}`;
  const [loaded, setLoaded] = useState<{ scope: string; value: T | undefined } | null>(null);
  const [edited, setEdited] = useState<{ scope: string; value: T } | null>(null);
  const pending = useRef<PendingDraft | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const initialRef = useRef(initial);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const draft = pending.current;
    pending.current = null;
    if (!draft) return;
    const stored = { version: DRAFT_FORMAT_VERSION, value: draft.value };
    writeEntry("drafts", draft.accountId, draft.key, stored).catch(reportError);
  }, []);

  useEffect(() => {
    const flushWhenHidden = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [flush]);

  useEffect(() => {
    let current = true;
    readEntry("drafts", accountId, key).then((stored) => {
      const value = restoreDraft(stored, initialRef.current);
      if (stored !== undefined && value === undefined) {
        deleteEntry("drafts", accountId, key).catch(reportError);
      }
      if (current) setLoaded({ scope, value });
    }, reportError);
    return () => {
      current = false;
      flush();
    };
  }, [accountId, key, scope, flush]);

  const set = useCallback(
    (next: T) => {
      setEdited({ scope, value: next });
      pending.current = { accountId, key, value: next };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DRAFT_SAVE_DELAY_MS);
    },
    [accountId, key, scope, flush],
  );

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    setEdited(null);
    setLoaded({ scope, value: undefined });
    deleteEntry("drafts", accountId, key).catch(reportError);
  }, [accountId, key, scope]);

  const isLoaded = loaded?.scope === scope;
  const restored = isLoaded ? loaded.value : undefined;
  const value =
    edited?.scope === scope ? edited.value : restored === undefined ? initial : restored;
  return [value, set, clear, isLoaded] as const;
}
