import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserDoubles } from "../internal/test-doubles";
import deployWorkflow from "./fixtures/deploy.yml?raw";
import environmentsFixture from "./fixtures/environments.json";
import jobLog from "./fixtures/job-log.txt?raw";
import jobsFixture from "./fixtures/jobs.json";
import runFixture from "./fixtures/run.json";
import runsFixture from "./fixtures/runs.json";
import workflowsFixture from "./fixtures/workflows.json";
import {
  MAX_LOG_BYTES,
  useCancelRun,
  useDispatchInputs,
  useDispatchWorkflow,
  useEnvironments,
  useJobLog,
  useRerunRun,
  useWorkflowRun,
  useWorkflowRuns,
  useWorkflows,
} from ".";

vi.mock("../session", () => ({
  useActiveAccount: () => ({ id: 312, login: "mona" }),
  useSession: () => ({ activeAccount: { id: 312, login: "mona" } }),
}));

const API = "https://api.github.com";
const REPO_API = `${API}/repos/octo-org/hello-mobile`;
const OWNER = "octo-org";
const REPO = "hello-mobile";
const RUN_ID = runFixture.id;
const LOG_HOST = "https://productionresultssa0.blob.core.windows.net";
const server = setupServer(
  http.post("/auth/token", () =>
    HttpResponse.json({ accessToken: "gho_actions_fixture", expiresAt: null }),
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
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  server.resetHandlers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => {
  server.close();
});

describe("workflows and runs", () => {
  it("lists workflows", async () => {
    server.use(
      http.get(`${REPO_API}/actions/workflows`, () => HttpResponse.json(workflowsFixture)),
    );
    const { result } = renderHook(() => useWorkflows(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual([
      { id: 161335, name: "CI", path: ".github/workflows/ci.yml", state: "active" },
      { id: 161336, name: "Deploy", path: ".github/workflows/deploy.yml", state: "active" },
      {
        id: 161337,
        name: "Nightly",
        path: ".github/workflows/nightly.yml",
        state: "disabled_manually",
      },
    ]);
  });

  it("maps runs and follows the next link", async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${REPO_API}/actions/runs`, ({ request }) => {
        urls.push(request.url);
        const second = new URL(request.url).searchParams.get("page") === "2";
        return HttpResponse.json(second ? { total_count: 3, workflow_runs: [] } : runsFixture, {
          headers: second
            ? {}
            : { Link: `<${REPO_API}/actions/runs?per_page=30&page=2>; rel="next"` },
        });
      }),
    );
    const filters = { workflowId: null, branch: null, event: null, status: null };
    const { result } = renderHook(() => useWorkflowRuns(OWNER, REPO, filters), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.pages[0]?.items[0]).toEqual({
      id: 11223344556,
      workflowId: 161335,
      name: "CI",
      displayTitle: "Translate the greeting",
      runNumber: 482,
      event: "pull_request",
      branch: "feature/i18n",
      status: "in_progress",
      conclusion: null,
      actor: { login: "mona", avatarUrl: "https://avatars.githubusercontent.com/u/583231?v=4" },
      createdAt: "2026-11-17T09:58:00Z",
      updatedAt: "2026-11-17T10:01:12Z",
      runStartedAt: "2026-11-17T09:58:03Z",
      webUrl: `https://github.com/${OWNER}/${REPO}/actions/runs/11223344556`,
    });
    expect(result.current.hasNextPage).toBe(true);
    await act(() => result.current.fetchNextPage());
    expect(urls).toEqual([
      `${REPO_API}/actions/runs?per_page=30`,
      `${REPO_API}/actions/runs?per_page=30&page=2`,
    ]);
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(false);
    });
  });

  it("filters by workflow, branch, event and status", async () => {
    let url = "";
    server.use(
      http.get(`${REPO_API}/actions/workflows/161335/runs`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ total_count: 0, workflow_runs: [] });
      }),
    );
    const filters = { workflowId: 161335, branch: "main", event: "push", status: "failure" };
    const { result } = renderHook(() => useWorkflowRuns(OWNER, REPO, filters), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      branch: "main",
      event: "push",
      status: "failure",
      per_page: "30",
    });
  });
});

describe("useWorkflowRun", () => {
  it("loads the run with jobs and refreshes every 10 s until it completes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    let runRequests = 0;
    server.use(
      http.get(`${REPO_API}/actions/runs/${String(RUN_ID)}`, () => {
        runRequests++;
        return HttpResponse.json(
          runRequests === 1
            ? runFixture
            : { ...runFixture, status: "completed", conclusion: "failure" },
        );
      }),
      http.get(`${REPO_API}/actions/runs/${String(RUN_ID)}/jobs`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("per_page")).toBe("100");
        return HttpResponse.json(jobsFixture);
      }),
    );
    const { result } = renderHook(() => useWorkflowRun(OWNER, REPO, RUN_ID), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const jobs = result.current.data?.jobs ?? [];
    expect(jobs[0]).toMatchObject({
      id: 31415926501,
      name: "lint",
      status: "completed",
      conclusion: "success",
      webUrl: `https://github.com/${OWNER}/${REPO}/actions/runs/${String(RUN_ID)}/job/31415926501`,
    });
    expect(jobs[1]).toMatchObject({
      status: "in_progress",
      completedAt: null,
      webUrl: `https://github.com/${OWNER}/${REPO}/actions/runs/${String(RUN_ID)}/job/31415926502`,
    });
    expect(jobs[1]?.steps[2]).toEqual({
      number: 3,
      name: "Run pnpm test",
      status: "in_progress",
      conclusion: null,
      startedAt: "2026-11-17T09:58:16Z",
      completedAt: null,
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await waitFor(() => {
      expect(result.current.data?.run.status).toBe("completed");
    });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(runRequests).toBe(2);
  });

  it("re-runs failed jobs, re-runs all and cancels", async () => {
    const posts: string[] = [];
    server.use(
      http.post(`${REPO_API}/actions/runs/:runId/:action`, ({ params }) => {
        posts.push(`${String(params.runId)} ${String(params.action)}`);
        return new HttpResponse(null, { status: params.action === "cancel" ? 202 : 201 });
      }),
    );
    const rerun = renderHook(() => useRerunRun(), { wrapper });
    const cancel = renderHook(() => useCancelRun(), { wrapper });
    await act(() =>
      rerun.result.current.mutateAsync({
        owner: OWNER,
        repo: REPO,
        runId: RUN_ID,
        failedOnly: true,
      }),
    );
    await act(() =>
      rerun.result.current.mutateAsync({
        owner: OWNER,
        repo: REPO,
        runId: RUN_ID,
        failedOnly: false,
      }),
    );
    await act(() => cancel.result.current.mutateAsync({ owner: OWNER, repo: REPO, runId: RUN_ID }));
    expect(posts).toEqual([
      `${String(RUN_ID)} rerun-failed-jobs`,
      `${String(RUN_ID)} rerun`,
      `${String(RUN_ID)} cancel`,
    ]);
  });
});

describe("useJobLog", () => {
  const logsUrl = `${REPO_API}/actions/jobs/31415926501/logs`;
  const blobUrl = `${LOG_HOST}/actions-results/7f3a/logs/job/job-logs.txt?sig=signed`;

  it("follows the redirect without sending the token to the log host", async () => {
    const authorization: (string | null)[] = [];
    server.use(
      http.get(logsUrl, ({ request }) => {
        authorization.push(request.headers.get("authorization"));
        return new HttpResponse(null, { status: 302, headers: { Location: blobUrl } });
      }),
      http.get(`${LOG_HOST}/actions-results/7f3a/logs/job/job-logs.txt`, ({ request }) => {
        authorization.push(request.headers.get("authorization"));
        return HttpResponse.text(jobLog);
      }),
    );
    const { result } = renderHook(() => useJobLog(OWNER, REPO, 31415926501, true), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // `Response.text()` strips the BOM.
    expect(result.current.data).toEqual({ text: jobLog.replace(/^\uFEFF/, ""), truncated: false });
    expect(authorization).toEqual(["Bearer gho_actions_fixture", null]);
  });

  it("fails at once on an unreadable redirect target but retries server errors", async () => {
    let logRequests = 0;
    let serverFailures = 0;
    server.use(
      http.get(logsUrl, () => {
        logRequests++;
        return new HttpResponse(null, { status: 302, headers: { Location: blobUrl } });
      }),
      http.get(`${LOG_HOST}/actions-results/7f3a/logs/job/job-logs.txt`, () =>
        HttpResponse.error(),
      ),
      http.get(`${REPO_API}/actions/jobs/31415926502/logs`, () => {
        serverFailures++;
        return HttpResponse.json({ message: "Server Error" }, { status: 502 });
      }),
    );
    // Mirrors the app's default retry policy.
    client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: (failures, error) =>
            failures < 3 && (error.kind === "network" || error.kind === "server"),
          retryDelay: 0,
        },
      },
    });
    const unreadable = renderHook(() => useJobLog(OWNER, REPO, 31415926501, true), { wrapper });
    await waitFor(() => {
      expect(unreadable.result.current.isError).toBe(true);
    });
    expect(unreadable.result.current.error).toMatchObject({ kind: "network" });
    expect(logRequests).toBe(1);
    const failing = renderHook(() => useJobLog(OWNER, REPO, 31415926502, true), { wrapper });
    await waitFor(() => {
      expect(failing.result.current.isError).toBe(true);
    });
    expect(serverFailures).toBe(4);
  });

  it("keeps only the last 5 MB from a line boundary", async () => {
    const line = "2026-11-17T09:58:12.1234567Z ✓ step output that repeats\n";
    const big = line.repeat(Math.ceil((MAX_LOG_BYTES * 1.2) / line.length));
    const body = new TextEncoder().encode(big);
    server.use(
      http.get(
        logsUrl,
        () => new HttpResponse(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } }),
      ),
    );
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const { result } = renderHook(() => useJobLog(OWNER, REPO, 31415926501, true), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    const text = result.current.data?.text ?? "";
    expect(result.current.data?.truncated).toBe(true);
    const encoded = encode.mock.calls.map(([input]) => input?.length ?? 0);
    expect(Math.max(...encoded)).toBeLessThanOrEqual(MAX_LOG_BYTES);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_LOG_BYTES);
    expect(text.startsWith("2026-11-17T09:58:12.1234567Z ✓")).toBe(true);
    expect(big.endsWith(text)).toBe(true);
  });

  it("does not request logs when disabled", () => {
    const { result } = renderHook(() => useJobLog(OWNER, REPO, 31415926501, false), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("workflow_dispatch", () => {
  it("reads inputs from the workflow file at the ref", async () => {
    let accept: string | null = null;
    let ref: string | null = null;
    server.use(
      http.get(`${REPO_API}/contents/.github/workflows/deploy.yml`, ({ request }) => {
        accept = request.headers.get("accept");
        ref = new URL(request.url).searchParams.get("ref");
        return HttpResponse.text(deployWorkflow);
      }),
    );
    const { result } = renderHook(
      () => useDispatchInputs(OWNER, REPO, ".github/workflows/deploy.yml", "release/2.0"),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.map((input) => `${input.type}:${input.name}`)).toEqual([
      "string:version",
      "boolean:dry_run",
      "number:replicas",
      "choice:region",
      "environment:target",
      "string:note",
    ]);
    expect([accept, ref]).toEqual(["application/vnd.github.raw", "release/2.0"]);
  });

  it("maps invalid YAML to a validation error", async () => {
    server.use(
      http.get(`${REPO_API}/contents/.github/workflows/broken.yml`, () =>
        HttpResponse.text("on: [push\n"),
      ),
    );
    const { result } = renderHook(
      () => useDispatchInputs(OWNER, REPO, ".github/workflows/broken.yml", "main"),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toMatchObject({ kind: "validation", fields: ["workflow"] });
  });

  it("lists environment names", async () => {
    server.use(http.get(`${REPO_API}/environments`, () => HttpResponse.json(environmentsFixture)));
    const { result } = renderHook(() => useEnvironments(OWNER, REPO), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(["staging", "production"]);
  });

  it("sends every input value as a string", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${REPO_API}/actions/workflows/161336/dispatches`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          workflow_run_id: 11223344600,
          run_url: `${REPO_API}/actions/runs/11223344600`,
          html_url: `https://github.com/${OWNER}/${REPO}/actions/runs/11223344600`,
        });
      }),
    );
    const { result } = renderHook(() => useDispatchWorkflow(), { wrapper });
    await act(() =>
      result.current.mutateAsync({
        owner: OWNER,
        repo: REPO,
        workflowId: 161336,
        ref: "main",
        inputs: { version: "2.0.1", dry_run: false, replicas: 3, region: "us-east-1" },
      }),
    );
    expect(body).toEqual({
      ref: "main",
      inputs: { version: "2.0.1", dry_run: "false", replicas: "3", region: "us-east-1" },
    });
  });
});
