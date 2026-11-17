import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { apiPath, nextPageUrl, rest } from "../internal/client";
import { property, stringProperty } from "../internal/json";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { toAppPath } from "../links";
import { useActiveAccount } from "../session";
import type { Actor, Page, RepoRef } from "../types";
export type FeedFilter = "all" | "releases" | "stars" | "pushes" | "issuesAndPrs" | "follows";
export interface FeedGroup {
  id: string;
  actor: Actor;
  repo: RepoRef | null;
  kind:
    "release" | "star" | "push" | "issue" | "pullRequest" | "follow" | "fork" | "create" | "other";
  events: readonly FeedEvent[];
  createdAt: string;
}
export interface FeedEvent {
  id: string;
  summary: FeedSummary;
  createdAt: string;
  appPath: string | null;
}
export type FeedSummary =
  | { kind: "push"; ref: string; commits: number }
  | { kind: "star" }
  | { kind: "release"; tagName: string }
  | { kind: "issue" | "pullRequest"; action: string; number: number; title: string }
  | { kind: "follow"; target: Actor }
  | { kind: "fork"; forkee: RepoRef }
  | { kind: "create"; refType: string; ref: string | null }
  | { kind: "other"; type: string };
interface GitHubEvent {
  id: string;
  type: string;
  actor: { login: string; avatar_url: string };
  repo: { name: string };
  payload: unknown;
  created_at: string;
}
const EVENTS_PER_PAGE = 100;
const MAX_EVENT_PAGES = 3;
function repoRef(fullName: string): RepoRef | null {
  const [owner, name] = fullName.split("/");
  return owner && name ? { owner, name } : null;
}
function summaryFor(event: GitHubEvent): FeedSummary {
  const payload = event.payload;
  switch (event.type) {
    case "WatchEvent":
      return { kind: "star" };
    case "PushEvent": {
      const size = property(payload, "size");
      const commits = property(payload, "commits");
      // Current events can omit commit totals.
      if (typeof size !== "number" && !Array.isArray(commits))
        return { kind: "other", type: event.type };
      return {
        kind: "push",
        ref: stringProperty(payload, "ref") ?? "",
        commits: typeof size === "number" ? size : Array.isArray(commits) ? commits.length : 0,
      };
    }
    case "ReleaseEvent":
      return {
        kind: "release",
        tagName: stringProperty(property(payload, "release"), "tag_name") ?? "",
      };
    case "IssuesEvent":
    case "PullRequestEvent": {
      const subject = property(payload, event.type === "IssuesEvent" ? "issue" : "pull_request");
      const number = property(subject, "number") ?? property(payload, "number");
      return {
        kind: event.type === "IssuesEvent" ? "issue" : "pullRequest",
        action: stringProperty(payload, "action") ?? "",
        number: typeof number === "number" ? number : 0,
        title: stringProperty(subject, "title") ?? "",
      };
    }
    case "FollowEvent": {
      const target = property(payload, "target");
      return {
        kind: "follow",
        target: {
          login: stringProperty(target, "login") ?? "",
          avatarUrl: stringProperty(target, "avatar_url") ?? "",
        },
      };
    }
    case "ForkEvent": {
      const fork = property(payload, "forkee");
      return {
        kind: "fork",
        forkee: repoRef(stringProperty(fork, "full_name") ?? "") ?? {
          owner: event.actor.login,
          name: event.repo.name.split("/")[1] ?? "",
        },
      };
    }
    case "CreateEvent":
      return {
        kind: "create",
        refType: stringProperty(payload, "ref_type") ?? "",
        ref: stringProperty(payload, "ref"),
      };
    default:
      return { kind: "other", type: event.type };
  }
}
function eventPath(repo: RepoRef | null, summary: FeedSummary): string | null {
  if (summary.kind === "follow") return toAppPath(`@${summary.target.login}`);
  if (!repo) return null;
  const base = `https://github.com/${repo.owner}/${repo.name}`;
  switch (summary.kind) {
    case "release":
      return toAppPath(`${base}/releases/tag/${encodeURIComponent(summary.tagName)}`);
    case "issue":
      return toAppPath(`${base}/issues/${String(summary.number)}`);
    case "pullRequest":
      return toAppPath(`${base}/pull/${String(summary.number)}`);
    default:
      return toAppPath(base);
  }
}
function matchesFilter(filter: FeedFilter, kind: FeedGroup["kind"]): boolean {
  switch (filter) {
    case "all":
      return true;
    case "releases":
      return kind === "release";
    case "stars":
      return kind === "star";
    case "pushes":
      return kind === "push";
    case "issuesAndPrs":
      return kind === "issue" || kind === "pullRequest";
    case "follows":
      return kind === "follow";
  }
}
function mapFeed(events: readonly GitHubEvent[], filter: FeedFilter): readonly FeedGroup[] {
  const groups: FeedGroup[] = [];
  for (const event of events) {
    const summary = summaryFor(event);
    const kind = event.type === "PushEvent" ? "push" : summary.kind;
    if (!matchesFilter(filter, kind)) continue;
    const repo = repoRef(event.repo.name);
    const entry = {
      id: event.id,
      summary,
      createdAt: event.created_at,
      appPath: eventPath(repo, summary),
    };
    const previous = groups.at(-1);
    if (
      previous &&
      previous.actor.login === event.actor.login &&
      previous.repo?.owner === repo?.owner &&
      previous.repo?.name === repo?.name &&
      previous.kind === kind
    ) {
      groups[groups.length - 1] = { ...previous, events: [...previous.events, entry] };
    } else
      groups.push({
        id: event.id,
        actor: { login: event.actor.login, avatarUrl: event.actor.avatar_url },
        repo,
        kind,
        events: [entry],
        createdAt: event.created_at,
      });
  }
  return groups;
}
function mergeFeedPages(
  response: InfiniteData<Page<FeedGroup>, number>,
): InfiniteData<Page<FeedGroup>, number> {
  const pages: Page<FeedGroup>[] = [];
  for (const page of response.pages) {
    const previousIndex = pages.findLastIndex((candidate) => candidate.items.length > 0);
    const previous = pages[previousIndex];
    const tail = previous?.items.at(-1);
    const first = page.items[0];
    if (
      previous &&
      tail &&
      first &&
      tail.actor.login === first.actor.login &&
      tail.repo?.owner === first.repo?.owner &&
      tail.repo?.name === first.repo?.name &&
      tail.kind === first.kind
    ) {
      pages[previousIndex] = {
        ...previous,
        items: [
          ...previous.items.slice(0, -1),
          { ...tail, events: [...tail.events, ...first.events] },
        ],
      };
      pages.push({ ...page, items: page.items.slice(1) });
    } else pages.push(page);
  }
  return { ...response, pages };
}
export function useActivityFeed(
  filter: FeedFilter,
): UseInfiniteQueryResult<InfiniteData<Page<FeedGroup>>> {
  const account = useActiveAccount();
  return useInfiniteQuery({
    queryKey: accountKey(account.id, "home", "activity", filter),
    initialPageParam: 1,
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    // GraphQL has no received-events feed.
    queryFn: async ({ pageParam, signal }): Promise<Page<FeedGroup>> => {
      const response = await rest<GitHubEvent[]>(account.id, {
        path: apiPath`/users/${account.login}/received_events`,
        query: { per_page: EVENTS_PER_PAGE, page: pageParam },
        revalidate: true,
        signal,
      });
      return {
        items: mapFeed(response.body, filter),
        nextCursor:
          pageParam < MAX_EVENT_PAGES && nextPageUrl(response.headers)
            ? String(pageParam + 1)
            : null,
      };
    },
    select: mergeFeedPages,
    getNextPageParam: (page) => (page.nextCursor === null ? undefined : Number(page.nextCursor)),
  });
}
