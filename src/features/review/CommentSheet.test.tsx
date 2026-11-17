import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { usePendingReview, type PendingComment } from "@/data/review";
import { I18nProvider, loadMessages } from "@/i18n/index.tsx";
import { CommentSheet } from "./CommentSheet.tsx";

vi.mock("@/data/session", () => ({ useActiveAccount: () => ({ id: 314 }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a conflicting save shows the peer text and keeps editing the local copy", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", window.sessionStorage);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  class LayoutObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal("ResizeObserver", LayoutObserver);
  vi.stubGlobal("IntersectionObserver", LayoutObserver);
  const repo = { owner: "octo", name: "mobile" };
  const peer = renderHook(() => usePendingReview(repo.owner, repo.name, 2));
  const original: PendingComment = {
    id: "draft",
    body: "Original",
    path: "a.ts",
    line: 1,
    side: "RIGHT",
  };
  const close = vi.fn();
  function Editor() {
    const pending = usePendingReview(repo.owner, repo.name, 2);
    return pending.isLoaded ? (
      <CommentSheet
        pull={{ repo, number: 2 }}
        target={{ kind: "edit", comment: original }}
        pending={pending}
        isOpen
        onOpenChange={close}
        onSaved={() => undefined}
      />
    ) : null;
  }
  await waitFor(() => {
    expect(peer.result.current.isLoaded).toBe(true);
  });
  act(() => {
    peer.result.current.restore(original);
  });
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={null}>
          <I18nProvider language="en">
            <Editor />
          </I18nProvider>
        </Suspense>
      </QueryClientProvider>,
    );
    await loadMessages("en");
  });
  const editor = await screen.findByRole("textbox", { name: "Review comment" });
  fireEvent.change(editor, { target: { value: "Local draft" } });
  const peerBody = "Text from the other tab";
  await act(async () => {
    await peer.result.current.update(original.id, peerBody, original.body);
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const notice = await screen.findByRole("alert");
  expect(notice.textContent).toContain("edited in another tab");
  expect(notice.textContent).toContain(peerBody);
  expect(screen.getByDisplayValue("Local draft")).toBe(editor);
  expect(close).not.toHaveBeenCalled();
  fireEvent.change(editor, { target: { value: "Updated local draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(close).toHaveBeenCalledWith(false);
  });
  expect(peer.result.current.comments.map((comment) => comment.body)).toEqual([
    peerBody,
    "Updated local draft",
  ]);
});
