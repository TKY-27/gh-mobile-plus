import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { GitHubError } from "../errors";
import { apiPath, GITHUB_RAW, nextPageUrl, rest } from "../internal/client";
import { restPages } from "../internal/pages";
import { usePollingInterval } from "../internal/polling";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { useActiveAccount, type AccountId } from "../session";
import type { Actor, Page } from "../types";
import { parseDispatchInputs, type DispatchInput } from "./dispatch";

export { parseDispatchInputs, type DispatchInput } from "./dispatch";
export { parseLog, type LogBlock, type LogGroup, type LogLine, type LogSpan } from "./log";

export type RunStatus =
  "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
export type RunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "stale"
  | "startup_failure"
  | null;

export interface WorkflowRun {
  id: number;
  workflowId: number;
  name: string;
  displayTitle: string;
  runNumber: number;
  event: string;
  branch: string | null;
  status: RunStatus;
  conclusion: RunConclusion;
  actor: Actor | null;
  createdAt: string;
  updatedAt: string;
  runStartedAt: string | null;
  webUrl: string;
}

export interface RunFilters {
  workflowId: number | null;
  branch: string | null;
  event: string | null;
  status: string | null;
}

export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface JobStep {
  number: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Job {
  id: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  startedAt: string | null;
  completedAt: string | null;
  steps: readonly JobStep[];
  webUrl: string;
}

export interface RunDetail {
  run: WorkflowRun;
  jobs: readonly Job[];
}

export const LOGS_READABLE: boolean = true;
export const MAX_LOG_BYTES = 5 * 1024 * 1024;

interface RestActor {
  login: string;
  avatar_url: string;
}

interface RestRun {
  id: number;
  workflow_id: number;
  name: string | null;
  path: string;
  display_title: string;
  run_number: number;
  event: string;
  head_branch: string | null;
  status: RunStatus | null;
  conclusion: RunConclusion;
  actor?: RestActor | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
  html_url: string;
}

interface RestStep {
  number: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  started_at?: string | null;
  completed_at?: string | null;
}

interface RestJob {
  id: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  started_at: string | null;
  completed_at: string | null;
  steps?: RestStep[];
  html_url: string | null;
}

const RUNS_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const RUN_REFRESH_MS = 10_000;
// Large logs would bloat persisted caches.
const LOG_CACHE_MS = 5 * 60_000;
const LOG_RETRIES = 3;

function runFrom(run: RestRun): WorkflowRun {
  return {
    id: run.id,
    workflowId: run.workflow_id,
    name: run.name ?? run.path,
    displayTitle: run.display_title,
    runNumber: run.run_number,
    event: run.event,
    branch: run.head_branch,
    status: run.status ?? "pending",
    conclusion: run.conclusion,
    actor: run.actor ? { login: run.actor.login, avatarUrl: run.actor.avatar_url } : null,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    runStartedAt: run.run_started_at ?? null,
    webUrl: run.html_url,
  };
}

function jobFrom(job: RestJob, run: WorkflowRun): Job {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    steps: (job.steps ?? []).map((step) => ({
      number: step.number,
      name: step.name,
      status: step.status,
      conclusion: step.conclusion,
      startedAt: step.started_at ?? null,
      completedAt: step.completed_at ?? null,
    })),
    webUrl: job.html_url ?? `${run.webUrl}/job/${String(job.id)}`,
  };
}

function actionsKey(accountId: AccountId, name: string, owner: string, repo: string) {
  return accountKey(accountId, "actions", name, owner, repo);
}

export function useWorkflows(owner: string, repo: string): UseQueryResult<readonly Workflow[]> {
  const accountId = useActiveAccount().id;
  return useQuery({
    queryKey: actionsKey(accountId, "workflows", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      // GraphQL has no Actions API.
      const pages = await restPages<{ workflows: Workflow[] }>(accountId, {
        path: apiPath`/repos/${owner}/${repo}/actions/workflows`,
        query: { per_page: MAX_PAGE_SIZE },
        revalidate: true,
        signal,
      });
      return pages
        .flatMap((page) => page.workflows)
        .map(({ id, name, path, state }) => ({ id, name, path, state }));
    },
  });
}

export function useWorkflowRuns(
  owner: string,
  repo: string,
  filters: RunFilters,
): UseInfiniteQueryResult<InfiniteData<Page<WorkflowRun>>> {
  const accountId = useActiveAccount().id;
  const { workflowId, branch, event, status } = filters;
  return useInfiniteQuery({
    queryKey: [...actionsKey(accountId, "runs", owner, repo), workflowId, branch, event, status],
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page<WorkflowRun>> => {
      const firstPage =
        workflowId === null
          ? apiPath`/repos/${owner}/${repo}/actions/runs`
          : apiPath`/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`;
      const response = await rest<{ workflow_runs: RestRun[] }>(accountId, {
        path: pageParam ?? firstPage,
        query: pageParam === null ? { branch, event, status, per_page: RUNS_PAGE_SIZE } : undefined,
        revalidate: true,
        signal,
      });
      return {
        items: response.body.workflow_runs.map(runFrom),
        nextCursor: nextPageUrl(response.headers),
      };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

export function useWorkflowRun(
  owner: string,
  repo: string,
  runId: number,
): UseQueryResult<RunDetail> {
  const accountId = useActiveAccount().id;
  // Bypass the shared polling interval floor.
  const pollingAllowed = usePollingInterval(RUN_REFRESH_MS) !== false;
  return useQuery({
    queryKey: [...actionsKey(accountId, "run", owner, repo), runId],
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }): Promise<RunDetail> => {
      const [runResponse, jobs] = await Promise.all([
        rest<RestRun>(accountId, {
          path: apiPath`/repos/${owner}/${repo}/actions/runs/${runId}`,
          revalidate: true,
          signal,
        }),
        restPages<{ jobs: RestJob[] }>(accountId, {
          path: apiPath`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
          query: { per_page: MAX_PAGE_SIZE },
          revalidate: true,
          signal,
        }),
      ]);
      const run = runFrom(runResponse.body);
      return { run, jobs: jobs.flatMap((page) => page.jobs).map((job) => jobFrom(job, run)) };
    },
    refetchInterval: (query) =>
      pollingAllowed && query.state.data?.run.status !== "completed" ? RUN_REFRESH_MS : false,
  });
}

function useInvalidateRuns(): (owner: string, repo: string) => Promise<void> {
  const accountId = useActiveAccount().id;
  const client = useQueryClient();
  return (owner, repo) =>
    client.invalidateQueries({
      predicate: ({ queryKey }) =>
        queryKey[0] === accountId &&
        queryKey[1] === "actions" &&
        (queryKey[2] === "runs" || queryKey[2] === "run") &&
        queryKey[3] === owner &&
        queryKey[4] === repo,
    });
}

export function useRerunRun(): UseMutationResult<
  void,
  GitHubError,
  { owner: string; repo: string; runId: number; failedOnly: boolean }
> {
  const accountId = useActiveAccount().id;
  const invalidateRuns = useInvalidateRuns();
  return useMutation({
    retry: false,
    mutationFn: async ({ owner, repo, runId, failedOnly }) => {
      await rest(accountId, {
        method: "POST",
        path: failedOnly
          ? apiPath`/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`
          : apiPath`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`,
      });
    },
    onSuccess: (_data, { owner, repo }) => invalidateRuns(owner, repo),
  });
}

export function useCancelRun(): UseMutationResult<
  void,
  GitHubError,
  { owner: string; repo: string; runId: number }
> {
  const accountId = useActiveAccount().id;
  const invalidateRuns = useInvalidateRuns();
  return useMutation({
    retry: false,
    mutationFn: async ({ owner, repo, runId }) => {
      await rest(accountId, {
        method: "POST",
        path: apiPath`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`,
      });
    },
    onSuccess: (_data, { owner, repo }) => invalidateRuns(owner, repo),
  });
}

function logTail(text: string, maxBytes: number): { text: string; truncated: boolean } {
  // UTF-16 units take one byte minimum.
  const candidate = text.length > maxBytes ? text.slice(-maxBytes) : text;
  const bytes = new TextEncoder().encode(candidate);
  if (candidate === text && bytes.length <= maxBytes) return { text, truncated: false };
  const tail = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - maxBytes)));
  return { text: tail.slice(tail.indexOf("\n") + 1), truncated: true };
}

export function useJobLog(
  owner: string,
  repo: string,
  jobId: number,
  enabled: boolean,
): UseQueryResult<{ text: string; truncated: boolean }> {
  const accountId = useActiveAccount().id;
  return useQuery({
    queryKey: [...actionsKey(accountId, "log", owner, repo), jobId],
    enabled: enabled && LOGS_READABLE,
    // Retrying cannot fix missing CORS headers.
    retry: (failures, error) => error.kind === "server" && failures < LOG_RETRIES,
    staleTime: STALE_TIME.detail,
    gcTime: LOG_CACHE_MS,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      // Cross-origin redirects drop Authorization.
      const response = await rest<string | undefined>(accountId, {
        path: apiPath`/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
        signal,
      });
      return logTail(response.body ?? "", MAX_LOG_BYTES);
    },
  });
}

export function useDispatchInputs(
  owner: string,
  repo: string,
  workflowPath: string,
  ref: string,
): UseQueryResult<readonly DispatchInput[] | null> {
  const accountId = useActiveAccount().id;
  return useQuery({
    queryKey: [...actionsKey(accountId, "dispatchInputs", owner, repo), workflowPath, ref],
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const segments = workflowPath.split("/").map((segment) => apiPath`/${segment}`);
      const response = await rest<string | undefined>(accountId, {
        path: apiPath`/repos/${owner}/${repo}/contents` + segments.join(""),
        query: { ref },
        accept: GITHUB_RAW,
        revalidate: true,
        signal,
      });
      return parseDispatchInputs(response.body ?? "");
    },
  });
}

export function useEnvironments(owner: string, repo: string): UseQueryResult<readonly string[]> {
  const accountId = useActiveAccount().id;
  return useQuery({
    queryKey: actionsKey(accountId, "environments", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const pages = await restPages<{ environments?: { name: string }[] }>(accountId, {
        path: apiPath`/repos/${owner}/${repo}/environments`,
        query: { per_page: MAX_PAGE_SIZE },
        revalidate: true,
        signal,
      });
      return pages.flatMap((page) => (page.environments ?? []).map(({ name }) => name));
    },
  });
}

export function useDispatchWorkflow(): UseMutationResult<
  void,
  GitHubError,
  {
    owner: string;
    repo: string;
    workflowId: number;
    ref: string;
    inputs: Readonly<Record<string, string | number | boolean>>;
  }
> {
  const accountId = useActiveAccount().id;
  const invalidateRuns = useInvalidateRuns();
  return useMutation({
    retry: false,
    mutationFn: async ({ owner, repo, workflowId, ref, inputs }) => {
      // GitHub may reject raw booleans.
      const values = Object.fromEntries(
        Object.entries(inputs).map(([name, value]) => [name, String(value)]),
      );
      await rest(accountId, {
        method: "POST",
        path: apiPath`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
        body: { ref, inputs: values },
      });
    },
    onSuccess: (_data, { owner, repo }) => invalidateRuns(owner, repo),
  });
}
