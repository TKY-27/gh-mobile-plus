import { errorDiagnostics } from "./errors";
import { API_ORIGIN, apiPath, gitHubHeaders, rest } from "./internal/client";
import {
  HTTP_NO_CONTENT,
  HTTP_NOT_MODIFIED,
  HTTP_OK,
  HTTP_RESET_CONTENT,
  MINUTE_MS,
} from "./internal/constants";
import { property, stringProperty } from "./internal/json";
import { getAccessToken, tokenLifetime } from "./internal/tokens";
import { readSession, type AccountId } from "./session";

export interface ProbeResult {
  name: string;
  ok: boolean;
  status: number | null;
  detail: string;
}

const SAMPLE_BYTES = 200;
const NOTIFICATIONS_PATH = "/notifications?all=true&per_page=50";

function activeAccountId(): AccountId {
  const account = readSession().activeAccount;
  if (account?.status !== "active") throw new Error("Diagnostics need a signed-in account");
  return account.id;
}

// Raw fetch keeps exact statuses for probes.
async function send(
  accountId: AccountId,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    redirect?: RequestRedirect;
  },
): Promise<Response> {
  const headers = gitHubHeaders(await getAccessToken(accountId));
  for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  return fetch(new URL(path, API_ORIGIN), {
    method: init.method ?? "GET",
    headers,
    cache: "no-store",
    redirect: init.redirect ?? "follow",
    body: init.body === undefined ? null : JSON.stringify(init.body),
  });
}

async function probe(
  name: string,
  expected: number,
  request: () => Promise<Response>,
): Promise<ProbeResult> {
  try {
    const response = await request();
    return { name, ok: response.status === expected, status: response.status, detail: "" };
  } catch (error) {
    return { name, ok: false, status: null, detail: errorDiagnostics(error) };
  }
}

function tokenSummary(accountId: AccountId): string {
  const lifetime = tokenLifetime(accountId);
  if (!lifetime) return "token=unknown";
  if (lifetime.remainingMs === null) return "token=persistent";
  return `token=expiring remainingMinutes=${String(Math.round(lifetime.remainingMs / MINUTE_MS))}`;
}

function oldestReadThread(threads: unknown): { id: string; title: string; repo: string } | null {
  if (!Array.isArray(threads)) return null;
  const read = threads.filter((thread: unknown) => property(thread, "unread") === false);
  const oldest: unknown = read.at(-1);
  const id = stringProperty(oldest, "id");
  if (id === null) return null;
  return {
    id,
    title: stringProperty(property(oldest, "subject"), "title") ?? "",
    repo: stringProperty(property(oldest, "repository"), "full_name") ?? "",
  };
}

export async function runSpikeS1(): Promise<readonly ProbeResult[]> {
  const accountId = activeAccountId();
  const results: ProbeResult[] = [];
  let list: Response;
  try {
    list = await send(accountId, NOTIFICATIONS_PATH, {});
  } catch (error) {
    return [
      { name: "List notifications", ok: false, status: null, detail: errorDiagnostics(error) },
    ];
  }
  const scopes = list.headers.get("x-oauth-scopes") ?? "none";
  results.push({
    name: "List notifications",
    ok: list.status === HTTP_OK,
    status: list.status,
    detail: `scopes=${scopes} ${tokenSummary(accountId)}`,
  });
  if (list.status !== HTTP_OK) return results;
  const threads: unknown = await list.json();
  const lastModified = list.headers.get("last-modified");
  results.push(
    lastModified === null
      ? { name: "If-Modified-Since", ok: false, status: null, detail: "No Last-Modified header" }
      : await probe("If-Modified-Since", HTTP_NOT_MODIFIED, () =>
          send(accountId, NOTIFICATIONS_PATH, { headers: { "If-Modified-Since": lastModified } }),
        ),
  );
  const thread = oldestReadThread(threads);
  if (!thread) {
    results.push({
      name: "Pick thread",
      ok: false,
      status: null,
      detail: "No read thread on the first page; nothing was changed",
    });
    return results;
  }
  results.push({
    name: "Pick thread",
    ok: true,
    status: null,
    detail: `Target thread ${thread.id} "${thread.title}" in ${thread.repo}: mark read and done, then ignore its subscription`,
  });
  const threadPath = apiPath`/notifications/threads/${thread.id}`;
  const subscriptionPath = `${threadPath}/subscription`;
  results.push(
    await probe("Mark read", HTTP_RESET_CONTENT, () =>
      send(accountId, threadPath, { method: "PATCH" }),
    ),
    await probe("Mark done", HTTP_NO_CONTENT, () =>
      send(accountId, threadPath, { method: "DELETE" }),
    ),
    await probe("Ignore subscription", HTTP_OK, () =>
      send(accountId, subscriptionPath, { method: "PUT", body: { ignored: true } }),
    ),
  );
  return results;
}

function firstId(body: unknown, listName: string): unknown {
  const list = property(body, listName);
  return Array.isArray(list) ? property(list[0], "id") : undefined;
}

async function latestCompletedJobId(
  accountId: AccountId,
  owner: string,
  repo: string,
): Promise<number> {
  const runs = await rest<unknown>(accountId, {
    path: apiPath`/repos/${owner}/${repo}/actions/runs`,
    query: { status: "completed", per_page: 1 },
  });
  const runId = firstId(runs.body, "workflow_runs");
  if (typeof runId !== "number") throw new Error("No completed workflow run");
  const jobs = await rest<unknown>(accountId, {
    path: apiPath`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
    query: { per_page: 1 },
  });
  const jobId = firstId(jobs.body, "jobs");
  if (typeof jobId !== "number") throw new Error("The latest completed run has no jobs");
  return jobId;
}

async function sampleLength(response: Response): Promise<number> {
  const reader = response.body?.getReader();
  if (!reader) return 0;
  const chunk = await reader.read();
  await reader.cancel();
  return Math.min(SAMPLE_BYTES, chunk.value?.length ?? 0);
}

async function readFollowedLog(accountId: AccountId, path: string): Promise<ProbeResult | null> {
  try {
    const response = await send(accountId, path, { redirect: "follow" });
    const bytes = await sampleLength(response);
    return {
      name: "Read job log",
      ok: response.ok && bytes > 0,
      status: response.status,
      detail: `finalHost=${new URL(response.url).host} readable=${String(response.ok)} sampleBytes=${String(bytes)}`,
    };
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

async function probeManualRedirect(accountId: AccountId, path: string): Promise<ProbeResult> {
  const name = "Manual redirect";
  try {
    const response = await send(accountId, path, { redirect: "manual" });
    const ok = response.type === "opaqueredirect";
    return { name, ok, status: response.status, detail: `type=${response.type}` };
  } catch (error) {
    return { name, ok: false, status: null, detail: errorDiagnostics(error) };
  }
}

// Log content can contain secrets.
export async function runSpikeS2(input: {
  owner: string;
  repo: string;
  jobId: number | null;
}): Promise<readonly ProbeResult[]> {
  const accountId = activeAccountId();
  let jobId: number;
  try {
    jobId = input.jobId ?? (await latestCompletedJobId(accountId, input.owner, input.repo));
  } catch (error) {
    return [{ name: "Find job", ok: false, status: null, detail: errorDiagnostics(error) }];
  }
  const found: ProbeResult = {
    name: "Find job",
    ok: true,
    status: null,
    detail: `job=${String(jobId)}`,
  };
  const logsPath = apiPath`/repos/${input.owner}/${input.repo}/actions/jobs/${jobId}/logs`;
  const followed = await readFollowedLog(accountId, logsPath);
  if (followed) return [found, followed];
  const blocked: ProbeResult = {
    name: "Read job log",
    ok: false,
    status: null,
    detail: "readable=false (network or CORS failure after redirect)",
  };
  return [found, blocked, await probeManualRedirect(accountId, logsPath)];
}
