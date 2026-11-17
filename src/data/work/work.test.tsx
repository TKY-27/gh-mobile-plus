import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "../internal/test-doubles";
import { property } from "../internal/json";
import { useWorkQueue } from ".";
import queue from "./fixtures/queue.json";
vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 102, login: "mona" }) }));
const server = setupServer(
  http.post("/auth/token", () => HttpResponse.json({ accessToken: "gho_test", expiresAt: null })),
);
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeAll(() => {
  installBrowserDoubles();
  server.listen({ onUnhandledFrame: "error" });
});
afterEach(() => {
  cleanup();
  client.clear();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
it("loads all four exact searches once and maps checks and queue counts", async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let requests = 0;
  server.use(
    http.post("https://api.github.com/graphql", async ({ request }) => {
      requests++;
      const query = property(await request.json(), "query");
      expect(query).toContain("is:open is:pr review-requested:@me archived:false");
      expect(query).toContain("is:open is:pr author:@me archived:false");
      expect(query).toContain("is:open assignee:@me archived:false");
      expect(query).toContain("is:open is:pr author:@me status:failure archived:false");
      return HttpResponse.json({ data: queue });
    }),
  );
  const { result } = renderHook(useWorkQueue, { wrapper });
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true);
  });
  expect(requests).toBe(1);
  expect(result.current.data?.reviewRequested.count).toBe(70);
  expect(result.current.data?.myPrs.items[0]).toMatchObject({
    kind: "pullRequest",
    checks: "failure",
    reviewDecision: "reviewRequired",
    isDraft: false,
  });
  expect(result.current.data?.assigned.items[0]).toMatchObject({
    kind: "issue",
    checks: null,
    reviewDecision: null,
    author: null,
  });
});
