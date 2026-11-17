import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftKeys } from "../drafts";
import { readEntry, writeEntry } from "../internal/storage";
import { installBrowserDoubles } from "../internal/test-doubles";
import { changePendingComments, usePendingReview, type PendingComment } from "./pending";

vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 314 }) }));

const ACCOUNT = 314;
const OWNER = "octo-org";
const REPO = "hello-mobile";
const ORIGINAL: PendingComment = {
  id: "original",
  commitOid: "head",
  baseOid: "base",
  path: "README.md",
  line: 1,
  side: "RIGHT",
  body: "Original comment",
};
const PEER = { ...ORIGINAL, id: "peer", body: "Added in another tab" };

beforeEach(() => {
  installBrowserDoubles();
});
afterEach(cleanup);

describe("pending review persistence", () => {
  it("preserves a peer edit queued while applying a local change", async () => {
    const key = draftKeys.pendingReview(OWNER, REPO, 1);
    await writeEntry("drafts", ACCOUNT, key, [ORIGINAL]);
    const open = indexedDB.open(`ghm-drafts-${String(ACCOUNT)}`);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error("Peer database open failed"));
      };
    });
    let peerCommit: Promise<void> | undefined;
    const edited = { ...ORIGINAL, body: "Edited in this tab" };
    try {
      await changePendingComments(ACCOUNT, key, (comments) => {
        peerCommit = new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("entries", "readwrite");
          const store = transaction.objectStore("entries");
          const read = store.get(key);
          read.onsuccess = () => {
            const drafts: unknown[] = Array.isArray(read.result) ? read.result : [];
            store.put([...drafts, PEER], key);
          };
          transaction.oncomplete = () => {
            resolve();
          };
          transaction.onabort = () => {
            reject(transaction.error ?? new Error("Peer transaction aborted"));
          };
        });
        return comments.map((comment) => (comment.id === edited.id ? edited : comment));
      });
      await peerCommit;
      expect(await readEntry("drafts", ACCOUNT, key)).toEqual([edited, PEER]);
    } finally {
      database.close();
    }
  });

  it("keeps both edits to the same comment and reports the latest text", async () => {
    const key = draftKeys.pendingReview(OWNER, REPO, 3);
    await writeEntry("drafts", ACCOUNT, key, [ORIGINAL]);
    const { result } = renderHook(() => usePendingReview(OWNER, REPO, 3));
    await waitFor(() => {
      expect(result.current.comments).toEqual([ORIGINAL]);
    });

    const latest = { ...ORIGINAL, body: "Saved by the other tab" };
    await writeEntry("drafts", ACCOUNT, key, [latest]);
    const mine = "My concurrent edit";
    await act(async () => {
      const outcome = await result.current.update(ORIGINAL.id, mine, ORIGINAL.body);
      expect(outcome).toMatchObject({ latestBody: latest.body });
    });
    const copy = result.current.comments.find((comment) => comment.id !== ORIGINAL.id);
    expect(copy).toMatchObject({ path: ORIGINAL.path, line: ORIGINAL.line, body: mine });
    expect(await readEntry("drafts", ACCOUNT, key)).toEqual([latest, copy]);
  });

  it("updates an open review when another tab commits a change", async () => {
    const key = draftKeys.pendingReview(OWNER, REPO, 2);
    await writeEntry("drafts", ACCOUNT, key, [ORIGINAL]);
    const { result } = renderHook(() => usePendingReview(OWNER, REPO, 2));
    await waitFor(() => {
      expect(result.current.comments).toEqual([ORIGINAL]);
    });

    const channel = new BroadcastChannel("ghm-pending-review");
    try {
      await writeEntry("drafts", ACCOUNT, key, [PEER]);
      const changed = new Promise<unknown>((resolve) => {
        channel.onmessage = (message: MessageEvent<unknown>) => {
          resolve(message.data);
        };
      });
      channel.postMessage({ accountId: ACCOUNT, key });
      await waitFor(() => {
        expect(result.current.comments).toEqual([PEER]);
      });

      act(() => {
        result.current.remove(PEER.id);
      });
      expect(await changed).toEqual({ accountId: ACCOUNT, key });
      expect(await readEntry("drafts", ACCOUNT, key)).toBeUndefined();
    } finally {
      channel.close();
    }
  });
});
