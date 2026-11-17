import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { ResultOf } from "gql.tada";
import { RECENT_SEARCHES_KEY_PREFIX } from "../internal/storage";
import { graphql as requestGraphQL, nextPageUrl, rest } from "../internal/client";
import { graphql } from "../internal/graphql";
import { property } from "../internal/json";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { mapRepositorySummary, repositorySummaryFragment } from "../internal/repository-summary";
import { useActiveAccount } from "../session";
import type { Page, RepoRef, RepoSummary } from "../types";
import { closedReason } from "../internal/subject-status";

export type SearchScope = "repositories" | "issues" | "users" | "code";
export type SearchResult =
  | { kind: "repository"; repo: RepoSummary }
  | {
      kind: "issue";
      repo: RepoRef;
      number: number;
      title: string;
      isPullRequest: boolean;
      state: "open" | "closed" | "merged";
      isDraft?: boolean;
      closedReason?: "completed" | "notPlanned" | null;
      updatedAt: string;
    }
  | { kind: "user"; login: string; name: string | null; avatarUrl: string; isOrganization: boolean }
  | { kind: "code"; repo: RepoRef; path: string; ref: string; fragment: string | null };

type SearchPage = Page<SearchResult> & { total: number };
interface RecentSearch {
  scope: SearchScope;
  query: string;
}
interface CodeSearchResponse {
  total_count: number;
  items: {
    path: string;
    html_url: string;
    repository: { name: string; owner: { login: string } };
    text_matches?: readonly { fragment: string }[];
  }[];
}

const PAGE_SIZE = 30;
const MAX_RECENT_SEARCHES = 20;
const TEXT_MATCH_MEDIA_TYPE = "application/vnd.github.text-match+json";
const CODE_BLOB_PATH = "/blob/";
const EMPTY_SEARCHES: readonly RecentSearch[] = [];
const recentSnapshots = new Map<
  string,
  { serialized: string | null; searches: readonly RecentSearch[] }
>();
const listeners = new Set<() => void>();

const searchDocument = graphql(
  `
    query Search($query: String!, $type: SearchType!, $cursor: String, $count: Int!) {
      search(query: $query, type: $type, first: $count, after: $cursor) {
        repositoryCount
        issueCount
        userCount
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          __typename
          ... on Repository {
            ...RepositorySummaryFields
          }
          ... on Issue {
            number
            title
            issueState: state
            stateReason
            updatedAt
            repository {
              owner {
                login
              }
              name
            }
          }
          ... on PullRequest {
            number
            title
            pullRequestState: state
            isDraft
            updatedAt
            repository {
              owner {
                login
              }
              name
            }
          }
          ... on User {
            login
            profileName: name
            avatarUrl
          }
          ... on Organization {
            login
            profileName: name
            avatarUrl
          }
        }
      }
    }
  `,
  [repositorySummaryFragment],
);

function mapSearchResult(
  result: NonNullable<NonNullable<ResultOf<typeof searchDocument>["search"]["nodes"]>[number]>,
): SearchResult | null {
  switch (result.__typename) {
    case "Repository":
      return { kind: "repository", repo: mapRepositorySummary(result) };
    case "Issue":
    case "PullRequest":
      return {
        kind: "issue",
        repo: { owner: result.repository.owner.login, name: result.repository.name },
        number: result.number,
        title: result.title,
        isPullRequest: result.__typename === "PullRequest",
        ...(result.__typename === "PullRequest"
          ? { isDraft: result.isDraft }
          : { closedReason: closedReason(result.stateReason) }),
        state:
          result.__typename === "Issue"
            ? result.issueState === "OPEN"
              ? "open"
              : "closed"
            : result.pullRequestState === "OPEN"
              ? "open"
              : result.pullRequestState === "MERGED"
                ? "merged"
                : "closed",
        updatedAt: result.updatedAt,
      };
    case "User":
    case "Organization":
      return {
        kind: "user",
        login: result.login,
        name: result.profileName,
        avatarUrl: result.avatarUrl,
        isOrganization: result.__typename === "Organization",
      };
    default:
      return null;
  }
}

function mapCodeResult(result: CodeSearchResponse["items"][number]): SearchResult[] {
  const url = URL.parse(result.html_url);
  if (!url) return [];
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    if (error instanceof URIError) return [];
    throw error;
  }
  const blobStart = pathname.indexOf(CODE_BLOB_PATH);
  const blobPath = blobStart < 0 ? null : pathname.slice(blobStart + CODE_BLOB_PATH.length);
  const suffix = `/${result.path}`;
  if (!blobPath?.endsWith(suffix)) return [];
  const ref = blobPath.slice(0, -suffix.length);
  if (ref === "") return [];
  return [
    {
      kind: "code",
      repo: { owner: result.repository.owner.login, name: result.repository.name },
      path: result.path,
      ref,
      fragment: result.text_matches?.[0]?.fragment ?? null,
    },
  ];
}

export function useSearch(
  scope: SearchScope,
  query: string,
): UseInfiniteQueryResult<InfiniteData<SearchPage>> {
  const account = useActiveAccount();
  const normalizedQuery = query.trim();
  return useInfiniteQuery({
    queryKey: accountKey(account.id, "search", scope, normalizedQuery),
    staleTime: STALE_TIME.list,
    meta: scope === "users" ? { persist: "user-search" } : PRIVATE_QUERY,
    enabled: normalizedQuery !== "",
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<SearchPage> => {
      if (scope === "code") {
        const response = await rest<CodeSearchResponse>(account.id, {
          path: pageParam ?? "/search/code",
          query: pageParam === null ? { q: normalizedQuery, per_page: PAGE_SIZE } : undefined,
          accept: TEXT_MATCH_MEDIA_TYPE,
          revalidate: true,
          signal,
        });
        return {
          items: response.body.items.flatMap(mapCodeResult),
          total: response.body.total_count,
          nextCursor: nextPageUrl(response.headers),
        };
      }
      const type = scope === "repositories" ? "REPOSITORY" : scope === "issues" ? "ISSUE" : "USER";
      const response = await requestGraphQL(
        account.id,
        searchDocument,
        { query: normalizedQuery, type, cursor: pageParam, count: PAGE_SIZE },
        signal,
      );
      const search = response.search;
      const total =
        scope === "repositories"
          ? search.repositoryCount
          : scope === "issues"
            ? search.issueCount
            : search.userCount;
      return {
        items: (search.nodes ?? []).flatMap((result) => {
          const mapped = result ? mapSearchResult(result) : null;
          return mapped && (scope !== "users" || mapped.kind === "user") ? [mapped] : [];
        }),
        total,
        nextCursor: search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null,
      };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

function isSearchScope(scope: unknown): scope is SearchScope {
  return scope === "repositories" || scope === "issues" || scope === "users" || scope === "code";
}

function parseSearches(serialized: string | null): readonly RecentSearch[] {
  if (serialized === null) return EMPTY_SEARCHES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    if (error instanceof SyntaxError) return EMPTY_SEARCHES;
    throw error;
  }
  if (!Array.isArray(parsed)) return EMPTY_SEARCHES;
  const searches: RecentSearch[] = [];
  for (const entry of parsed) {
    const scope = property(entry, "scope");
    const query = property(entry, "query");
    if (!isSearchScope(scope) || typeof query !== "string" || query.trim() === "") continue;
    const normalizedQuery = query.trim();
    if (!searches.some((search) => search.scope === scope && search.query === normalizedQuery))
      searches.push({ scope, query: normalizedQuery });
    if (searches.length === MAX_RECENT_SEARCHES) break;
  }
  return searches;
}

function readSearches(key: string): readonly RecentSearch[] {
  const serialized = localStorage.getItem(key);
  const snapshot = recentSnapshots.get(key);
  if (snapshot && snapshot.serialized === serialized) return snapshot.searches;
  const searches = parseSearches(serialized);
  recentSnapshots.set(key, { serialized, searches });
  return searches;
}

function notify(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

window.addEventListener("storage", (event) => {
  if (event.key === null || event.key.startsWith(RECENT_SEARCHES_KEY_PREFIX)) notify();
});

export function useRecentSearches(): {
  searches: readonly RecentSearch[];
  add(entry: RecentSearch): void;
  clear(): void;
} {
  const account = useActiveAccount();
  const key = `${RECENT_SEARCHES_KEY_PREFIX}${String(account.id)}`;
  const searches = useSyncExternalStore(subscribe, () => readSearches(key));
  return {
    searches,
    add: (entry) => {
      const query = entry.query.trim();
      if (query === "") return;
      const next = [
        { scope: entry.scope, query },
        ...readSearches(key).filter(
          (search) => search.scope !== entry.scope || search.query !== query,
        ),
      ].slice(0, MAX_RECENT_SEARCHES);
      localStorage.setItem(key, JSON.stringify(next));
      notify();
    },
    clear: () => {
      localStorage.removeItem(key);
      notify();
    },
  };
}
