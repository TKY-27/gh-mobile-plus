import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ResultOf } from "gql.tada";
import { graphql } from "../internal/graphql";
import { graphql as requestGraphQL } from "../internal/client";
import { DAY_MS } from "../internal/constants";
import { nodesOf } from "../internal/connection";
import { mapRepositorySummary, repositorySummaryFragment } from "../internal/repository-summary";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { useActiveAccount } from "../session";
import type { Release, RepoSummary } from "../types";
export { useActivityFeed } from "./feed";
export type { FeedFilter, FeedGroup, FeedEvent, FeedSummary } from "./feed";

export interface ContributionDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}
export interface ViewerSummary {
  login: string;
  name: string | null;
  avatarUrl: string;
  followers: number;
  following: number;
  recentRepositories?: readonly RepoSummary[];
  contributions: { total: number; weeks: readonly (readonly ContributionDay[])[] };
}
const viewerDocument = graphql(
  `
    query ViewerSummary($recentRepositoryLimit: Int!) {
      viewer {
        login
        name
        avatarUrl
        followers {
          totalCount
        }
        following {
          totalCount
        }
        repositories(
          first: $recentRepositoryLimit
          ownerAffiliations: [OWNER]
          orderBy: { field: PUSHED_AT, direction: DESC }
        ) {
          nodes {
            ...RepositorySummaryFields
          }
        }
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                contributionLevel
              }
            }
          }
        }
      }
    }
  `,
  [repositorySummaryFragment],
);
const releasesDocument = graphql(`
  query StarredReleases($releasesPerRepository: Int!) {
    viewer {
      starredRepositories(first: 100, orderBy: { field: STARRED_AT, direction: DESC }) {
        nodes {
          name
          owner {
            login
          }
          releases(first: $releasesPerRepository, orderBy: { field: CREATED_AT, direction: DESC }) {
            nodes {
              tagName
              name
              publishedAt
              isPrerelease
              isDraft
              author {
                login
                avatarUrl
              }
            }
          }
        }
      }
    }
  }
`);
const RECENT_REPOSITORY_LIMIT = 6;
const CALENDAR_WEEKS = 52;
const RELEASE_WINDOW_MS = 14 * DAY_MS;
const RELEASES_PER_REPOSITORY = 10;
const contributionLevels = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
} as const;
function mapViewer(response: ResultOf<typeof viewerDocument>): ViewerSummary {
  const viewer = response.viewer;
  const calendar = viewer.contributionsCollection.contributionCalendar;
  return {
    login: viewer.login,
    name: viewer.name,
    avatarUrl: viewer.avatarUrl,
    followers: viewer.followers.totalCount,
    following: viewer.following.totalCount,
    recentRepositories: nodesOf(viewer.repositories).map(mapRepositorySummary),
    contributions: {
      total: calendar.totalContributions,
      weeks: calendar.weeks.slice(-CALENDAR_WEEKS).map((week) =>
        week.contributionDays.map((day) => ({
          date: day.date,
          count: day.contributionCount,
          level: contributionLevels[day.contributionLevel],
        })),
      ),
    },
  };
}
function mapReleases(response: ResultOf<typeof releasesDocument>): readonly Release[] {
  const now = Date.now();
  const cutoff = now - RELEASE_WINDOW_MS;
  return (response.viewer.starredRepositories.nodes ?? [])
    .flatMap((repository) =>
      repository
        ? (repository.releases.nodes ?? []).flatMap((release) => {
            if (!release?.publishedAt || release.isDraft) return [];
            const published = Date.parse(release.publishedAt);
            if (!(published >= cutoff && published <= now)) return [];
            return [
              {
                repo: { owner: repository.owner.login, name: repository.name },
                tagName: release.tagName,
                name: release.name ?? release.tagName,
                publishedAt: release.publishedAt,
                isPrerelease: release.isPrerelease,
                author: release.author,
              },
            ];
          })
        : [],
    )
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
}
export function useViewerSummary(): UseQueryResult<ViewerSummary> {
  const account = useActiveAccount();
  return useQuery<ViewerSummary>({
    queryKey: accountKey(account.id, "home", "viewer"),
    staleTime: (query) =>
      query.state.data?.recentRepositories === undefined ? 0 : STALE_TIME.calendar,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) =>
      mapViewer(
        await requestGraphQL(
          account.id,
          viewerDocument,
          { recentRepositoryLimit: RECENT_REPOSITORY_LIMIT },
          signal,
        ),
      ),
  });
}
export function useStarredReleases(enabled = true): UseQueryResult<readonly Release[]> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: accountKey(account.id, "home", "releases"),
    enabled,
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) =>
      mapReleases(
        await requestGraphQL(
          account.id,
          releasesDocument,
          { releasesPerRepository: RELEASES_PER_REPOSITORY },
          signal,
        ),
      ),
  });
}
