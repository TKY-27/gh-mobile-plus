import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "../internal/test-doubles";
import { parsePatch } from "../review";
import commitFixture from "./fixtures/commit.json";
import { useCommit } from ".";

vi.mock("../session", () => ({ useActiveAccount: () => ({ id: 313, login: "mona" }) }));

const SHA = commitFixture.sha;
const COMMIT_URL = `https://api.github.com/repos/octo-org/hello-mobile/commits/${SHA}`;
const server = setupServer(
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_commits_fixture", expiresAt: null }),
  ),
);
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("useCommit", () => {
  it("maps the message, author and files from one request", async () => {
    let requests = 0;
    server.use(
      http.get(COMMIT_URL, () => {
        requests++;
        return HttpResponse.json(commitFixture);
      }),
    );
    const { result } = renderHook(() => useCommit("octo-org", "hello-mobile", SHA), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const commit = result.current.data;
    expect(commit).toMatchObject({
      oid: SHA,
      repo: { owner: "octo-org", name: "hello-mobile" },
      messageHeadline: "Translate the greeting",
      messageBody:
        "Adds a tiny i18n helper and switches the\ndefault locale to Japanese.\n\n  - keeps formatName",
      author: { login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4" },
      authorName: "Mona Lisa",
      committedAt: "2026-11-17T09:57:30Z",
      parents: ["a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"],
      additions: 8430,
      deletions: 3988,
      checks: null,
      webUrl: `https://github.com/octo-org/hello-mobile/commit/${SHA}`,
    });
    const greeting = commit?.files.find((file) => file.path === "src/greeting.ts");
    expect(greeting?.hunks).toEqual(parsePatch(commitFixture.files[0]?.patch ?? ""));
    expect(commit?.files.find((file) => file.path === "pnpm-lock.yaml")?.hunks).toBeNull();
    expect(commit?.files.every((file) => file.viewed === "unviewed")).toBe(true);
    expect(requests).toBe(1);
  });

  it("caps files at 300", async () => {
    const files = Array.from({ length: 301 }, (_, index) => ({
      ...commitFixture.files[0],
      filename: `src/file-${String(index)}.ts`,
    }));
    server.use(http.get(COMMIT_URL, () => HttpResponse.json({ ...commitFixture, files })));
    const { result } = renderHook(() => useCommit("octo-org", "hello-mobile", SHA), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.files).toHaveLength(300);
  });

  it("surfaces a missing commit as notFound", async () => {
    server.use(
      http.get(COMMIT_URL, () => HttpResponse.json({ message: "Not Found" }, { status: 404 })),
    );
    const { result } = renderHook(() => useCommit("octo-org", "hello-mobile", SHA), { wrapper });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toEqual(expect.objectContaining({ kind: "notFound" }));
  });
});
