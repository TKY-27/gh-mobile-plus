import { graphql } from "../internal/graphql";

export const repositoryQuery = graphql(`
  query Repository($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
      name
      owner {
        login
      }
      description
      isPrivate
      isFork
      parent {
        name
        owner {
          login
        }
      }
      stargazerCount
      forkCount
      watchers {
        totalCount
      }
      primaryLanguage {
        name
        color
      }
      licenseInfo {
        name
      }
      defaultBranchRef {
        name
      }
      viewerHasStarred
      viewerSubscription
      viewerPermission
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      hasIssuesEnabled
      url
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`);

export const refsQuery = graphql(`
  query RepositoryRefs(
    $owner: String!
    $repo: String!
    $query: String
    $pageSize: Int!
    $branchesAfter: String
    $tagsAfter: String
    $withBranches: Boolean!
    $withTags: Boolean!
  ) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        name
      }
      branches: refs(
        refPrefix: "refs/heads/"
        first: $pageSize
        after: $branchesAfter
        query: $query
        orderBy: { field: ALPHABETICAL, direction: ASC }
      ) @include(if: $withBranches) {
        nodes {
          name
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      tags: refs(
        refPrefix: "refs/tags/"
        first: $pageSize
        after: $tagsAfter
        query: $query
        orderBy: { field: ALPHABETICAL, direction: ASC }
      ) @include(if: $withTags) {
        nodes {
          name
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`);

export const treeQuery = graphql(`
  query RepositoryTree($owner: String!, $repo: String!, $expression: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: $expression) {
        __typename
        ... on Tree {
          entries {
            name
            path
            type
            mode
            size
          }
        }
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`);

export const resolveRefQuery = graphql(`
  query ResolveRepositoryRef($owner: String!, $repo: String!, $branch: String!, $tag: String!) {
    repository(owner: $owner, name: $repo) {
      branch: ref(qualifiedName: $branch) {
        name
        prefix
      }
      tag: ref(qualifiedName: $tag) {
        name
        prefix
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`);

export const fileQuery = graphql(`
  query RepositoryFile(
    $owner: String!
    $repo: String!
    $expression: String!
    $ref: String!
    $branchRef: String!
  ) {
    repository(owner: $owner, name: $repo) {
      isPrivate
      branch: ref(qualifiedName: $branchRef) {
        prefix
        target {
          oid
        }
      }
      head: object(expression: $ref) {
        __typename
        oid
        ... on Tag {
          target {
            oid
          }
        }
      }
      object(expression: $expression) {
        __typename
        ... on Blob {
          byteSize
          isBinary
          isTruncated
          text
          oid
        }
      }
    }
    rateLimit {
      limit
      remaining
      resetAt
    }
  }
`);

const releaseFragment = graphql(`
  fragment RepositoryRelease on Release {
    tagName
    name
    publishedAt
    createdAt
    isPrerelease
    author {
      login
      avatarUrl
    }
  }
`);

export const releasesQuery = graphql(
  `
    query RepositoryReleases($owner: String!, $repo: String!, $after: String) {
      repository(owner: $owner, name: $repo) {
        releases(first: 30, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            ...RepositoryRelease
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      rateLimit {
        limit
        remaining
        resetAt
      }
    }
  `,
  [releaseFragment],
);

export const releaseQuery = graphql(
  `
    query RepositoryReleaseDetail($owner: String!, $repo: String!, $tag: String!, $after: String) {
      repository(owner: $owner, name: $repo) {
        release(tagName: $tag) {
          ...RepositoryRelease
          descriptionHTML
          url
          releaseAssets(first: 100, after: $after) {
            nodes {
              name
              size
              downloadUrl
              downloadCount
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
      rateLimit {
        limit
        remaining
        resetAt
      }
    }
  `,
  [releaseFragment],
);

export const addStarMutation = graphql(`
  mutation StarRepository($id: ID!) {
    addStar(input: { starrableId: $id }) {
      clientMutationId
    }
  }
`);
export const removeStarMutation = graphql(`
  mutation UnstarRepository($id: ID!) {
    removeStar(input: { starrableId: $id }) {
      clientMutationId
    }
  }
`);
export const watchMutation = graphql(`
  mutation WatchRepository($id: ID!, $state: SubscriptionState!) {
    updateSubscription(input: { subscribableId: $id, state: $state }) {
      clientMutationId
    }
  }
`);

export { releaseFragment };
