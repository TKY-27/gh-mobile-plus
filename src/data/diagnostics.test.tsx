import "fake-indexeddb/auto";
import { cleanup, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "./internal/test-doubles";

const API = "https://api.github.com";
const TOKEN = "gho_diagnostics_secret";
const LAST_MODIFIED = "Tue, 17 Nov 2026 10:00:00 GMT";
const calls: string[] = [];

const threads = [
  { id: "3", unread: true, subject: { title: "Newest" }, repository: { full_name: "o/r" } },
  { id: "2", unread: false, subject: { title: "Middle" }, repository: { full_name: "o/r" } },
  { id: "1", unread: false, subject: { title: "Oldest read" }, repository: { full_name: "o/r" } },
];

const server = setupServer(
  http.get("/auth/accounts", () =>
    HttpResponse.json([
      { id: 1, login: "octo", avatarUrl: "https://a.example/1", publicOnly: false },
    ]),
  ),
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: TOKEN, expiresAt: Date.now() + 2 * 3_600_000 }),
  ),
  http.all(`${API}/*`, ({ request }) => {
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    return undefined;
  }),
  http.get(`${API}/notifications`, ({ request }) =>
    request.headers.get("If-Modified-Since") === LAST_MODIFIED
      ? new HttpResponse(null, { status: 304 })
      : HttpResponse.json(threads, {
          headers: { "Last-Modified": LAST_MODIFIED, "X-OAuth-Scopes": "notifications, repo" },
        }),
  ),
  http.patch(`${API}/notifications/threads/:id`, () => new HttpResponse(null, { status: 205 })),
  http.delete(`${API}/notifications/threads/:id`, () => new HttpResponse(null, { status: 204 })),
  http.put(`${API}/notifications/threads/:id/subscription`, async ({ request }) => {
    expect(await request.json()).toEqual({ ignored: true });
    return HttpResponse.json({ ignored: true });
  }),
  http.delete(
    `${API}/notifications/threads/:id/subscription`,
    () => new HttpResponse(null, { status: 403 }),
  ),
  http.get(`${API}/repos/o/r/actions/runs`, () =>
    HttpResponse.json({ workflow_runs: [{ id: 40 }] }),
  ),
  http.get(`${API}/repos/o/r/actions/runs/40/jobs`, () =>
    HttpResponse.json({ jobs: [{ id: 41 }] }),
  ),
  http.get(`${API}/repos/o/r/actions/jobs/41/logs`, () => HttpResponse.text("2026-11-17 log line")),
);

async function signedIn() {
  vi.resetModules();
  const session = await import("./session");
  const diagnostics = await import("./diagnostics");
  render(<session.SessionProvider>{null}</session.SessionProvider>);
  await waitFor(() => {
    expect(session.readSession().activeAccount?.id).toBe(1);
  });
  return diagnostics;
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
});
beforeEach(() => {
  installBrowserDoubles();
  calls.length = 0;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("runSpikeS1", () => {
  it("probes only the app's notification calls on the oldest read thread", async () => {
    const { runSpikeS1 } = await signedIn();
    const results = await runSpikeS1();
    expect(results.map((result) => [result.name, result.ok, result.status])).toEqual([
      ["List notifications", true, 200],
      ["If-Modified-Since", true, 304],
      ["Pick thread", true, null],
      ["Mark read", true, 205],
      ["Mark done", true, 204],
      ["Ignore subscription", true, 200],
    ]);
    expect(results[0]?.detail).toMatch(
      /scopes=notifications, repo token=expiring remainingMinutes=12\d/,
    );
    expect(results[2]?.detail).toBe(
      'Target thread 1 "Oldest read" in o/r: mark read and done, then ignore its subscription',
    );
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual([
      "PATCH /notifications/threads/1",
      "DELETE /notifications/threads/1",
      "PUT /notifications/threads/1/subscription",
    ]);
    expect(JSON.stringify(results)).not.toContain(TOKEN);
  });

  it("changes nothing when no read thread exists", async () => {
    server.use(http.get(`${API}/notifications`, () => HttpResponse.json([threads[0]])));
    const { runSpikeS1 } = await signedIn();
    const results = await runSpikeS1();
    expect(results.at(-1)).toMatchObject({ name: "Pick thread", ok: false });
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
  });
});

describe("runSpikeS2", () => {
  it("finds a completed job and reports the readable log host", async () => {
    const { runSpikeS2 } = await signedIn();
    const results = await runSpikeS2({ owner: "o", repo: "r", jobId: null });
    expect(results).toEqual([
      { name: "Find job", ok: true, status: null, detail: "job=41" },
      {
        name: "Read job log",
        ok: true,
        status: 200,
        detail: "finalHost=api.github.com readable=true sampleBytes=19",
      },
    ]);
  });

  it("reports a CORS failure and tries a manual redirect", async () => {
    server.use(http.get(`${API}/repos/o/r/actions/jobs/7/logs`, () => HttpResponse.error()));
    const { runSpikeS2 } = await signedIn();
    const results = await runSpikeS2({ owner: "o", repo: "r", jobId: 7 });
    expect(results.map((result) => [result.name, result.ok])).toEqual([
      ["Find job", true],
      ["Read job log", false],
      ["Manual redirect", false],
    ]);
  });
});
