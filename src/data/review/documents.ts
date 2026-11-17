import { graphql } from "../internal/graphql";

export const pullFilesQuery = graphql(`
  query PullFiles($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        baseRefOid
        headRefOid
        changedFiles
        files(first: 100, after: $after) {
          nodes {
            path
            viewerViewedState
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
`);

export const markFileViewedMutation = graphql(`
  mutation MarkFileViewed($input: MarkFileAsViewedInput!) {
    markFileAsViewed(input: $input) {
      clientMutationId
    }
  }
`);

export const unmarkFileViewedMutation = graphql(`
  mutation UnmarkFileViewed($input: UnmarkFileAsViewedInput!) {
    unmarkFileAsViewed(input: $input) {
      clientMutationId
    }
  }
`);

export const reviewThreadsQuery = graphql(`
  query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          nodes {
            id
            path
            line
            startLine
            diffSide
            isResolved
            isOutdated
            viewerCanResolve
            viewerCanUnresolve
            comments(first: 100) {
              nodes {
                id
                author {
                  login
                  avatarUrl
                }
                body
                bodyHTML
                createdAt
              }
              pageInfo {
                hasNextPage
              }
            }
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
`);

export const resolveThreadMutation = graphql(`
  mutation ResolveReviewThread($input: ResolveReviewThreadInput!) {
    resolveReviewThread(input: $input) {
      thread {
        id
      }
    }
  }
`);

export const unresolveThreadMutation = graphql(`
  mutation UnresolveReviewThread($input: UnresolveReviewThreadInput!) {
    unresolveReviewThread(input: $input) {
      thread {
        id
      }
    }
  }
`);

export const replyToThreadMutation = graphql(`
  mutation ReplyToReviewThread($input: AddPullRequestReviewThreadReplyInput!) {
    addPullRequestReviewThreadReply(input: $input) {
      comment {
        id
      }
    }
  }
`);

export const pendingReviewQuery = graphql(`
  query PendingReview($pullRequestId: ID!, $author: String!) {
    node(id: $pullRequestId) {
      ... on PullRequest {
        baseRefOid
        headRefOid
        reviews(states: [PENDING], author: $author, first: 1) {
          nodes {
            id
            databaseId
            comments(first: 1) {
              totalCount
            }
            commit {
              oid
            }
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

export const reviewDismissalsQuery = graphql(`
  query ReviewDismissals($pullRequestId: ID!, $before: String) {
    node(id: $pullRequestId) {
      ... on PullRequest {
        timelineItems(last: 100, before: $before, itemTypes: [REVIEW_DISMISSED_EVENT]) {
          nodes {
            ... on ReviewDismissedEvent {
              review {
                id
              }
              previousReviewState
            }
          }
          pageInfo {
            hasPreviousPage
            startCursor
          }
        }
      }
    }
  }
`);

export const reviewStateQuery = graphql(`
  query ReviewState($id: ID!) {
    node(id: $id) {
      ... on PullRequestReview {
        body
        commit {
          oid
        }
        databaseId
        comments(first: 1) {
          totalCount
        }
        state
      }
    }
  }
`);

export const startReviewMutation = graphql(`
  mutation StartReview($input: AddPullRequestReviewInput!) {
    addPullRequestReview(input: $input) {
      pullRequestReview {
        id
      }
    }
  }
`);

export const addReviewThreadMutation = graphql(`
  mutation AddReviewThread($input: AddPullRequestReviewThreadInput!) {
    addPullRequestReviewThread(input: $input) {
      thread {
        id
      }
    }
  }
`);

export const submitReviewMutation = graphql(`
  mutation SubmitReview($input: SubmitPullRequestReviewInput!) {
    submitPullRequestReview(input: $input) {
      pullRequestReview {
        id
      }
    }
  }
`);

export const fileAtCommitQuery = graphql(`
  query SuggestionFile($owner: String!, $repo: String!, $oid: GitObjectID!, $path: String!) {
    repository(owner: $owner, name: $repo) {
      object(oid: $oid) {
        ... on Commit {
          file(path: $path) {
            object {
              ... on Blob {
                text
                isBinary
                isTruncated
              }
            }
          }
        }
      }
    }
  }
`);

export const pullPendingReviewQuery = graphql(`
  query PullPendingReview($owner: String!, $repo: String!, $number: Int!, $author: String!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        baseRefOid
        headRefOid
        reviews(states: [PENDING], author: $author, first: 1) {
          nodes {
            id
            body
            databaseId
            commit {
              oid
            }
            comments(first: 1) {
              totalCount
            }
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

export const deleteReviewMutation = graphql(`
  mutation DeletePendingReview($input: DeletePullRequestReviewInput!) {
    deletePullRequestReview(input: $input) {
      pullRequestReview {
        id
      }
    }
  }
`);
