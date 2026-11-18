import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { isGitHubError, type GitHubError } from "../errors";
import { apiPath, nextPageUrl, rest } from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { MIN_POLL_INTERVAL_MS, pollIntervalFrom, usePollingInterval } from "../internal/polling";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { runThrottledWrites } from "../internal/queue";
import { toAppPath } from "../links";
import { useActiveAccount } from "../session";
import type { Page, RepoRef } from "../types";
export type InboxFilter = "unread" | "participating" | "all";
export type NotificationSubjectType =
  | "Issue"
  | "PullRequest"
  | "Release"
  | "Commit"
  | "Discussion"
  | "CheckSuite"
  | "RepositoryVulnerabilityAlert"
  | "Other";
export interface InboxThread {
  id: string;
  repo: RepoRef;
  subjectType: NotificationSubjectType;
  title: string;
  reason: string;
  unread: boolean;
  updatedAt: string;
  appPath: string | null;
  webUrl: string;
}
export const UNDO_WINDOW_MS = 5000;
export interface BulkProgress {
  total: number;
  done: number;
  failed: number;
  stoppedByRateLimit: boolean;
  running: boolean;
}
type OrgRestriction = Extract<GitHubError, { kind: "orgAccessRestricted" }>;
interface BulkResult extends BulkProgress {
  restrictions: readonly OrgRestriction[];
}
type InboxPages = InfiniteData<Page<InboxThread>>;
type ThreadAction = "done" | "read";
interface NotificationResponse {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  subject: { title: string; type: string; url: string | null; latest_comment_url: string | null };
  repository: { name: string; owner: { login: string }; html_url: string; private: boolean };
}
interface PendingAction {
  action: ThreadAction;
  undo(): void;
}
const pendingActions = new WeakMap<QueryClient, Map<string, PendingAction>>();
const INBOX_PAGE_SIZE = 50;
const UNREAD_COUNT_PAGE_SIZE = 1;
const LAST_PAGE_LINK = /<([^>]+)>;\s*rel="last"/;
function pendingFor(client: QueryClient): Map<string, PendingAction> {
  let pending = pendingActions.get(client);
  if (!pending) {
    pending = new Map();
    pendingActions.set(client, pending);
  }
  return pending;
}
function subjectType(type: string): NotificationSubjectType {
  switch (type) {
    case "Issue":
    case "PullRequest":
    case "Release":
    case "Commit":
    case "Discussion":
    case "CheckSuite":
    case "RepositoryVulnerabilityAlert":
      return type;
    default:
      return "Other";
  }
}
function mapThread(thread: NotificationResponse): InboxThread {
  const repo = { owner: thread.repository.owner.login, name: thread.repository.name };
  const base = `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const type = subjectType(thread.subject.type);
  const subjectUrl = thread.subject.url;
  const apiUrl = subjectUrl && URL.canParse(subjectUrl) ? new URL(subjectUrl) : null;
  const pathname = apiUrl?.origin === "https://api.github.com" ? apiUrl.pathname : "";
  const suffix = pathname.split("/").at(-1);
  let webUrl = base;
  switch (type) {
    case "Issue":
      webUrl = suffix ? `${base}/issues/${suffix}` : `${base}/issues`;
      break;
    case "PullRequest":
      webUrl = suffix ? `${base}/pull/${suffix}` : `${base}/pulls`;
      break;
    case "Commit":
      if (suffix) webUrl = `${base}/commit/${suffix}`;
      break;
    case "Release":
      webUrl = `${base}/releases`;
      break;
    case "Discussion":
      webUrl = suffix ? `${base}/discussions/${suffix}` : `${base}/discussions`;
      break;
    case "CheckSuite": {
      // Check suite IDs differ from run IDs.
      const run = /\/actions\/runs\/(\d+)$/.exec(pathname)?.[1];
      webUrl = run ? `${base}/actions/runs/${run}` : `${base}/actions`;
      break;
    }
    case "RepositoryVulnerabilityAlert":
      webUrl = `${base}/security/dependabot`;
      break;
    case "Other":
      webUrl = `https://github.com/notifications?query=${encodeURIComponent(`repo:${repo.owner}/${repo.name}`)}`;
      break;
  }
  const appPath = webUrl === base ? null : toAppPath(webUrl);
  return {
    id: thread.id,
    repo,
    subjectType: type,
    title: thread.subject.title,
    reason: thread.reason,
    unread: thread.unread,
    updatedAt: thread.updated_at,
    appPath,
    webUrl,
  };
}
function applyToPage(
  page: Page<InboxThread>,
  filter: InboxFilter,
  threadId: string,
  action: ThreadAction,
): Page<InboxThread> {
  return {
    ...page,
    items: page.items.flatMap((thread) =>
      thread.id !== threadId
        ? [thread]
        : action === "done" || filter === "unread"
          ? []
          : [{ ...thread, unread: false }],
    ),
  };
}
function overlayPending(
  client: QueryClient,
  filter: InboxFilter,
  page: Page<InboxThread>,
): Page<InboxThread> {
  let visible = page;
  for (const [threadId, pending] of pendingFor(client))
    visible = applyToPage(visible, filter, threadId, pending.action);
  return visible;
}
export function useInbox(
  filter: InboxFilter,
): UseInfiniteQueryResult<InfiniteData<Page<InboxThread>>> {
  const account = useActiveAccount();
  const client = useQueryClient();
  const [pollMs, setPollMs] = useState(MIN_POLL_INTERVAL_MS);
  const interval = usePollingInterval(pollMs);
  const queryKey = accountKey(account.id, "inbox", filter);
  return useInfiniteQuery({
    queryKey,
    initialPageParam: "1",
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    refetchInterval: interval,
    // GraphQL lacks the notifications inbox.
    queryFn: async ({ pageParam, signal }): Promise<Page<InboxThread>> => {
      const response = await rest<NotificationResponse[]>(account.id, {
        path: "/notifications",
        query: {
          all: filter !== "unread",
          participating: filter === "participating",
          is_done: false,
          per_page: INBOX_PAGE_SIZE,
          page: pageParam,
        },
        revalidate: !client.getQueryState(queryKey)?.isInvalidated,
        signal,
      });
      setPollMs(pollIntervalFrom(response.headers));
      const cached = client.getQueryData<InboxPages>(queryKey);
      const cachedIndex = cached?.pageParams.indexOf(pageParam) ?? -1;
      const cachedPage = cached?.pages[cachedIndex];
      if (response.notModified && cachedPage) return overlayPending(client, filter, cachedPage);
      const nextUrl = nextPageUrl(response.headers);
      const page = {
        items: response.body.map(mapThread),
        nextCursor: nextUrl ? new URL(nextUrl).searchParams.get("page") : null,
      };
      return overlayPending(client, filter, page);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
// Shell mounting keeps the badge current.
export function useUnreadCount(): number | null {
  const account = useActiveAccount();
  const client = useQueryClient();
  const queryKey = accountKey(account.id, "unreadCount");
  const [pollMs, setPollMs] = useState(MIN_POLL_INTERVAL_MS);
  const interval = usePollingInterval(pollMs);
  const count = useQuery({
    queryKey,
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    refetchInterval: interval,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      const request = {
        path: "/notifications",
        query: { per_page: UNREAD_COUNT_PAGE_SIZE },
        // Reading needn't change notification timestamps.
        revalidate: !client.getQueryState(queryKey)?.isInvalidated,
        signal,
      };
      let response = await rest<NotificationResponse[]>(account.id, request);
      const cached = client.getQueryData<number>(queryKey);
      if (response.notModified && cached === undefined) {
        response = await rest<NotificationResponse[]>(account.id, {
          ...request,
          revalidate: false,
        });
      }
      setPollMs(pollIntervalFrom(response.headers));
      if (response.notModified && cached !== undefined) return cached;
      const last = LAST_PAGE_LINK.exec(response.headers.get("link") ?? "")?.[1];
      if (last) {
        const page = Number(new URL(last).searchParams.get("page"));
        if (!Number.isSafeInteger(page) || page < 1)
          throw gitHubFailure({ kind: "server", status: response.status });
        return page;
      }
      return response.body.length;
    },
  });
  return count.data ?? null;
}

async function invalidateInbox(client: QueryClient, accountId: number): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: accountKey(accountId, "inbox") }),
    client.invalidateQueries({ queryKey: accountKey(accountId, "unreadCount") }),
  ]);
}
interface ThreadSnapshot {
  key: QueryKey;
  pages: readonly { index: number; position: number; thread: InboxThread }[];
}
function optimisticallyApply(
  client: QueryClient,
  accountId: number,
  action: ThreadAction,
  threadId: string,
): ThreadSnapshot[] {
  const prefix = accountKey(accountId, "inbox");
  void client.cancelQueries({ queryKey: prefix }).catch(reportError);
  const snapshots: ThreadSnapshot[] = [];
  for (const [key, cached] of client.getQueriesData<InboxPages>({ queryKey: prefix })) {
    if (!cached) continue;
    snapshots.push({
      key,
      pages: cached.pages.flatMap((page, index) =>
        page.items.flatMap((thread, position) =>
          thread.id === threadId ? [{ index, position, thread }] : [],
        ),
      ),
    });
    const filter =
      key[2] === "unread" ? "unread" : key[2] === "participating" ? "participating" : "all";
    client.setQueryData<InboxPages>(key, {
      ...cached,
      pages: cached.pages.map((page) => applyToPage(page, filter, threadId, action)),
    });
  }
  return snapshots;
}
function rollback(client: QueryClient, snapshots: readonly ThreadSnapshot[]): void {
  for (const snapshot of snapshots)
    client.setQueryData<InboxPages>(snapshot.key, (cached) => {
      if (!cached) return cached;
      return {
        ...cached,
        pages: cached.pages.map((page, index) => {
          const original = snapshot.pages.find((entry) => entry.index === index);
          if (!original) return page;
          const threads = page.items.filter((thread) => thread.id !== original.thread.id);
          threads.splice(Math.min(original.position, threads.length), 0, original.thread);
          return { ...page, items: threads };
        }),
      };
    });
}
async function writeAction(
  accountId: number,
  action: ThreadAction,
  threadId: string,
): Promise<void> {
  await rest(accountId, {
    path: apiPath`/notifications/threads/${threadId}`,
    method: action === "read" ? "PATCH" : "DELETE",
  });
}
export interface ThreadActionOptions {
  // Opening should mark read immediately.
  immediate?: boolean;
  // Undo expires when the write starts.
  onSend?: () => void;
}
export function useThreadAction(): (
  action: ThreadAction,
  threadId: string,
  options?: ThreadActionOptions,
) => { undo(): void; settled: Promise<void> } {
  const account = useActiveAccount();
  const client = useQueryClient();
  return useCallback(
    (action, threadId, options = {}) => {
      const pending = pendingFor(client);
      pending.get(threadId)?.undo();
      const snapshots = optimisticallyApply(client, account.id, action, threadId);
      let undo = (): void => undefined;
      const settled = new Promise<void>((resolve, reject) => {
        let started = false;
        const timer = setTimeout(
          () => {
            started = true;
            options.onSend?.();
            writeAction(account.id, action, threadId)
              .then(
                () => {
                  resolve();
                },
                (error: unknown) => {
                  rollback(client, snapshots);
                  reject(
                    error instanceof Error
                      ? error
                      : new Error("Notification action failed", { cause: error }),
                  );
                },
              )
              .finally(() => {
                pending.delete(threadId);
                void invalidateInbox(client, account.id).catch(reportError);
              })
              .catch(reportError);
          },
          options.immediate ? 0 : UNDO_WINDOW_MS,
        );
        undo = () => {
          if (started) return;
          clearTimeout(timer);
          pending.delete(threadId);
          rollback(client, snapshots);
          // Filters opened during Undo have no snapshot.
          void client
            .invalidateQueries({ queryKey: accountKey(account.id, "inbox") })
            .catch(reportError);
          resolve();
        };
      });
      pending.set(threadId, { action, undo });
      return { undo, settled };
    },
    [account.id, client],
  );
}
export function useUnsubscribeThread(): UseMutationResult<void, GitHubError, { threadId: string }> {
  const account = useActiveAccount();
  return useMutation({
    retry: false,
    mutationFn: async ({ threadId }: { threadId: string }): Promise<void> => {
      // DELETE retains watched-repository notifications.
      await rest(account.id, {
        path: apiPath`/notifications/threads/${threadId}/subscription`,
        method: "PUT",
        body: { ignored: true },
      });
    },
  });
}
export function useBulkThreadAction(): {
  run(action: ThreadAction, threadIds: readonly string[]): Promise<BulkResult>;
  progress: BulkProgress | null;
} {
  const account = useActiveAccount();
  const client = useQueryClient();
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const running = useRef(false);
  const run = async (action: ThreadAction, threadIds: readonly string[]): Promise<BulkResult> => {
    if (running.current)
      throw gitHubFailure({ kind: "conflict", message: "A bulk action is already running" });
    running.current = true;
    const uniqueIds = [...new Set(threadIds)];
    setProgress({
      total: uniqueIds.length,
      done: 0,
      failed: 0,
      stoppedByRateLimit: false,
      running: true,
    });
    const snapshots = new Map<string, ThreadSnapshot[]>();
    const succeeded = new Set<string>();
    const restrictions = new Map<string, OrgRestriction>();
    const pending = pendingFor(client);
    for (const threadId of uniqueIds) {
      pending.get(threadId)?.undo();
      const snapshot = optimisticallyApply(client, account.id, action, threadId);
      snapshots.set(threadId, snapshot);
      pending.set(threadId, { action, undo: () => undefined });
    }
    try {
      const result = await runThrottledWrites(
        uniqueIds,
        async (threadId) => {
          await writeAction(account.id, action, threadId);
          succeeded.add(threadId);
        },
        (result) => {
          setProgress({ ...result, running: true });
        },
        (error) => {
          if (isGitHubError(error) && error.kind === "orgAccessRestricted") {
            const previous = restrictions.get(error.org);
            if (!previous?.ssoUrl) restrictions.set(error.org, error);
          }
        },
      );
      const finished = { ...result, running: false };
      setProgress(finished);
      return { ...finished, restrictions: [...restrictions.values()] };
    } finally {
      for (const threadId of [...uniqueIds].reverse()) {
        pending.delete(threadId);
        if (!succeeded.has(threadId)) rollback(client, snapshots.get(threadId) ?? []);
      }
      running.current = false;
      await invalidateInbox(client, account.id);
    }
  };
  return { run, progress };
}
