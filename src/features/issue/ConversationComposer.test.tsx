import "fake-indexeddb/auto";
import { Suspense } from "react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider, loadMessages } from "@/i18n/index.tsx";
import { ToastRegion } from "@/ui/Toast.tsx";
import { ConversationComposer } from "./ConversationComposer.tsx";

const postComment = vi.fn<(comment: { subjectId: string; body: string }) => Promise<void>>();
vi.mock("@/data/issues", () => ({
  useAddComment: () => useMutation({ mutationFn: postComment }),
}));
vi.mock("@/data/session", () => ({ useActiveAccount: () => ({ id: 7 }) }));

afterEach(cleanup);

test("a posted comment clears only the text that was sent", async () => {
  let acknowledge = () => {};
  const response = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  postComment.mockReturnValueOnce(response).mockResolvedValueOnce(undefined);
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Suspense fallback={null}>
          <I18nProvider language="en">
            <ConversationComposer
              subjectId="issue"
              repo={{ owner: "octo", name: "repo" }}
              number={1}
            />
            <ToastRegion />
          </I18nProvider>
        </Suspense>
      </QueryClientProvider>,
    );
    await loadMessages("en");
  });
  const field = screen.getByRole("textbox", { name: "Comment" });
  fireEvent.change(field, { target: { value: "First comment" } });
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
  await waitFor(() => {
    expect(postComment).toHaveBeenCalledOnce();
  });
  fireEvent.change(field, { target: { value: "Next comment" } });
  acknowledge();
  await screen.findByText("Comment posted");
  expect(screen.getByDisplayValue("Next comment")).toBe(field);
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
  await waitFor(() => {
    expect(screen.getByDisplayValue("")).toBe(field);
  });
  expect(postComment.mock.calls.map(([comment]) => comment.body)).toEqual([
    "First comment",
    "Next comment",
  ]);
});
