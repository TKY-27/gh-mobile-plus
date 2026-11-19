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
import type { ResultOf } from "gql.tada";
import { isGitHubError, type GitHubError } from "../errors";
import {
  apiPath,
  GITHUB_HTML_JSON,
  graphql as requestGraphQL,
  nextPageUrl,
  rest,
} from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { graphql } from "../internal/graphql";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { mapRepositorySummary, repositorySummaryFragment } from "../internal/repository-summary";
import { useActiveAccount } from "../session";
import type { Actor, Page, RepoSummary } from "../types";

export interface UserProfile {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  repositoryCount?: number;
  socialAccounts?: readonly { displayName: string; url: string }[];
  followers: number;
  following: number;
  isViewer: boolean;
  viewerIsFollowing: boolean;
  isOrganization: boolean;
  hasPublicReadmeRepository?: boolean;
  readmeHtml?: string | null;
  pinned: readonly RepoSummary[];
}

const PAGE_SIZE = 30;
const ORGANIZATIONS_PAGE_SIZE = 100;
const README_REPOSITORY_PATH = ["repositoryOwner", "repository"] as const;
const profileDocument = graphql(
  `
    query Profile($login: String!) {
      repositoryOwner(login: $login) {
        __typename
        login
        avatarUrl
        repositories(ownerAffiliations: [OWNER]) {
          totalCount
        }
        ... on User {
          repository(name: $login) {
            isPrivate
          }
          name
          bio
          company
          location
          websiteUrl
          isViewer
          socialAccounts(first: 4) {
            nodes {
              displayName
              url
            }
          }
          viewerIsFollowing
          followers {
            totalCount
          }
          following {
            totalCount
          }
          pinnedItems(first: 6, types: [REPOSITORY]) {
            nodes {
              __typename
              ... on Repository {
                ...RepositorySummaryFields
              }
            }
          }
        }
        ... on Organization {
          name
          description
          location
          websiteUrl
          viewerIsFollowing
          pinnedItems(first: 6, types: [REPOSITORY]) {
            nodes {
              __typename
              ... on Repository {
                ...RepositorySummaryFields
              }
            }
          }
        }
      }
    }
  `,
  [repositorySummaryFragment],
);

function mapProfile(
  owner: NonNullable<ResultOf<typeof profileDocument>["repositoryOwner"]>,
): UserProfile {
  return {
    login: owner.login,
    name: owner.name,
    avatarUrl: owner.avatarUrl,
    bio: owner.__typename === "User" ? owner.bio : owner.description,
    company: owner.__typename === "User" ? owner.company : null,
    location: owner.location,
    websiteUrl: owner.websiteUrl,
    repositoryCount: owner.repositories.totalCount,
    socialAccounts:
      owner.__typename === "User"
        ? (owner.socialAccounts.nodes ?? []).flatMap((social) => (social ? [social] : []))
        : [],
    followers: owner.__typename === "User" ? owner.followers.totalCount : 0,
    following: owner.__typename === "User" ? owner.following.totalCount : 0,
    isViewer: owner.__typename === "User" && owner.isViewer,
    viewerIsFollowing: owner.viewerIsFollowing,
    isOrganization: owner.__typename === "Organization",
    hasPublicReadmeRepository: owner.__typename === "User" && owner.repository?.isPrivate === false,
    pinned: (owner.pinnedItems.nodes ?? []).flatMap((repository) =>
      repository?.__typename === "Repository" ? [mapRepositorySummary(repository)] : [],
    ),
  };
}

export function useProfile(login: string): UseQueryResult<UserProfile> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: accountKey(account.id, "users", "profile", login.toLowerCase()),
    staleTime: STALE_TIME.detail,
    meta: { persist: "profile" },
    queryFn: async ({ signal }) => {
      const response = await requestGraphQL(
        account.id,
        profileDocument,
        { login },
        signal,
        README_REPOSITORY_PATH,
      );
      if (!response.repositoryOwner) throw gitHubFailure({ kind: "notFound" });
      return mapProfile(response.repositoryOwner);
    },
  });
}

export function useProfileReadme(login: string, enabled: boolean): UseQueryResult<string | null> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: accountKey(account.id, "users", "readme", login.toLowerCase()),
    staleTime: STALE_TIME.readme,
    meta: PRIVATE_QUERY,
    enabled,
    queryFn: async ({ signal }) => {
      try {
        const readme = await rest<string>(account.id, {
          path: apiPath`/repos/${login}/${login}/readme`,
          accept: GITHUB_HTML_JSON,
          revalidate: true,
          signal,
        });
        return readme.body;
      } catch (error) {
        if (isGitHubError(error) && error.kind === "notFound") return null;
        throw error;
      }
    },
  });
}

export function useFollow(): UseMutationResult<
  void,
  GitHubError,
  { login: string; follow: boolean }
> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  const profilesKey = accountKey(account.id, "users", "profile");
  return useMutation({
    retry: false,
    mutationFn: async ({ login, follow }) => {
      await rest(account.id, {
        path: apiPath`/user/following/${login}`,
        method: follow ? "PUT" : "DELETE",
      });
    },
    onMutate: async ({ login, follow }) => {
      await queryClient.cancelQueries({ queryKey: profilesKey });
      const snapshots = queryClient.getQueriesData<UserProfile>({ queryKey: profilesKey });
      const target = snapshots.find(
        ([, profile]) => profile?.login.toLowerCase() === login.toLowerCase(),
      )?.[1];
      const delta = target && target.viewerIsFollowing !== follow ? (follow ? 1 : -1) : 0;
      for (const [key, profile] of snapshots) {
        if (!profile) continue;
        queryClient.setQueryData<UserProfile>(key, {
          ...profile,
          ...(profile.login.toLowerCase() === login.toLowerCase()
            ? { viewerIsFollowing: follow, followers: Math.max(0, profile.followers + delta) }
            : {}),
          ...(profile.isViewer ? { following: Math.max(0, profile.following + delta) } : {}),
        });
      }
      return snapshots;
    },
    onError: (_error, _variables, snapshots) => {
      snapshots?.forEach(([key, profile]) => queryClient.setQueryData(key, profile));
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: profilesKey }),
        queryClient.invalidateQueries({ queryKey: accountKey(account.id, "users", "connections") }),
        queryClient.invalidateQueries({ queryKey: accountKey(account.id, "home", "viewer") }),
      ]);
    },
  });
}

const repositoriesDocument = graphql(
  `
    query RepositoriesOf(
      $login: String!
      $cursor: String
      $count: Int!
      $owned: Boolean!
      $starred: Boolean!
    ) {
      repositoryOwner(login: $login) {
        repositories(
          first: $count
          after: $cursor
          ownerAffiliations: [OWNER]
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) @include(if: $owned) {
          nodes {
            ...RepositorySummaryFields
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
        ... on User {
          starredRepositories(
            first: $count
            after: $cursor
            orderBy: { field: STARRED_AT, direction: DESC }
          ) @include(if: $starred) {
            nodes {
              ...RepositorySummaryFields
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    }
  `,
  [repositorySummaryFragment],
);

export function useRepositoriesOf(
  login: string,
  kind: "owned" | "starred",
): UseInfiniteQueryResult<InfiniteData<Page<RepoSummary>>> {
  const account = useActiveAccount();
  return useInfiniteQuery({
    queryKey: accountKey(account.id, "users", "repositories", login, kind),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page<RepoSummary>> => {
      const response = await requestGraphQL(
        account.id,
        repositoriesDocument,
        {
          login,
          cursor: pageParam,
          count: PAGE_SIZE,
          owned: kind === "owned",
          starred: kind === "starred",
        },
        signal,
      );
      const owner = response.repositoryOwner;
      if (!owner) throw gitHubFailure({ kind: "notFound" });
      const connection =
        kind === "owned"
          ? owner.repositories
          : "starredRepositories" in owner
            ? owner.starredRepositories
            : null;
      return {
        items: (connection?.nodes ?? []).flatMap((repository) =>
          repository ? [mapRepositorySummary(repository)] : [],
        ),
        nextCursor: connection?.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
      };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

const organizationsDocument = graphql(`
  query ViewerOrganizations($cursor: String, $count: Int!) {
    viewer {
      organizations(first: $count, after: $cursor) {
        nodes {
          login
          name
          avatarUrl
          viewerCanCreateRepositories
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`);

interface ViewerOrganization {
  login: string;
  name: string | null;
  avatarUrl: string;
  viewerCanCreateRepositories?: boolean;
}

export function useViewerOrganizations(): UseQueryResult<readonly ViewerOrganization[]> {
  const account = useActiveAccount();
  return useQuery<readonly ViewerOrganization[]>({
    queryKey: accountKey(account.id, "users", "organizations"),
    staleTime: (query) =>
      query.state.data?.some(
        (organization) => organization.viewerCanCreateRepositories === undefined,
      )
        ? 0
        : STALE_TIME.list,
    queryFn: async ({ signal }) => {
      const organizations: ViewerOrganization[] = [];
      let cursor: string | null = null;
      do {
        const response: ResultOf<typeof organizationsDocument> = await requestGraphQL(
          account.id,
          organizationsDocument,
          { cursor, count: ORGANIZATIONS_PAGE_SIZE },
          signal,
        );
        organizations.push(
          ...(response.viewer.organizations.nodes ?? []).flatMap((organization) =>
            organization ? [organization] : [],
          ),
        );
        cursor = response.viewer.organizations.pageInfo.hasNextPage
          ? response.viewer.organizations.pageInfo.endCursor
          : null;
      } while (cursor !== null);
      return organizations;
    },
  });
}

const membersDocument = graphql(`
  query OrganizationMembers($org: String!, $cursor: String, $count: Int!) {
    organization(login: $org) {
      membersWithRole(first: $count, after: $cursor) {
        nodes {
          login
          avatarUrl
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`);

export function useOrganizationMembers(
  org: string,
): UseInfiniteQueryResult<InfiniteData<Page<Actor>>> {
  const account = useActiveAccount();
  return useInfiniteQuery({
    queryKey: accountKey(account.id, "users", "members", org),
    networkMode: "online",
    staleTime: STALE_TIME.list,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page<Actor>> => {
      const response = await requestGraphQL(
        account.id,
        membersDocument,
        { org, cursor: pageParam, count: PAGE_SIZE },
        signal,
      );
      if (!response.organization) throw gitHubFailure({ kind: "notFound" });
      const members = response.organization.membersWithRole;
      return {
        items: (members.nodes ?? []).flatMap((member) => (member ? [member] : [])),
        nextCursor: members.pageInfo.hasNextPage ? members.pageInfo.endCursor : null,
      };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

export function useProfileConnections(login: string, kind: "followers" | "following") {
  const account = useActiveAccount();
  return useInfiniteQuery({
    queryKey: accountKey(account.id, "users", "connections", login.toLowerCase(), kind),
    networkMode: "online",
    staleTime: STALE_TIME.list,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page<Actor>> => {
      const response = await rest<readonly { login: string; avatar_url: string }[]>(account.id, {
        path: pageParam ?? apiPath`/users/${login}/${kind}`,
        query: pageParam ? undefined : { per_page: PAGE_SIZE },
        signal,
      });
      return {
        items: response.body.map((user) => ({ login: user.login, avatarUrl: user.avatar_url })),
        nextCursor: nextPageUrl(response.headers),
      };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}
