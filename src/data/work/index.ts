import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ResultOf } from "gql.tada";
import { graphql } from "../internal/graphql";
import { graphql as requestGraphQL } from "../internal/client";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { useActiveAccount } from "../session";
import type { Actor, ChecksState, RepoRef, ReviewDecision } from "../types";
export type WorkSegment = "reviewRequested" | "myPrs" | "assigned" | "ciFailing";
export interface WorkItem {
  kind: "pullRequest" | "issue";
  repo: RepoRef;
  number: number;
  title: string;
  checks: ChecksState;
  reviewDecision: ReviewDecision;
  isDraft: boolean;
  updatedAt: string;
  author: Actor | null;
}
export type WorkQueue = Record<WorkSegment, { count: number; items: readonly WorkItem[] }>;
const workFields = graphql(`
  fragment WorkFields on SearchResultItem @_unmask {
    __typename
    ... on Issue {
      number
      title
      updatedAt
      author {
        login
        avatarUrl
      }
      repository {
        name
        owner {
          login
        }
      }
    }
    ... on PullRequest {
      number
      title
      updatedAt
      author {
        login
        avatarUrl
      }
      repository {
        name
        owner {
          login
        }
      }
      isDraft
      reviewDecision
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
            }
          }
        }
      }
    }
  }
`);
const workDocument = graphql(
  `
    query WorkQueue {
      reviewRequested: search(
        type: ISSUE
        first: 50
        query: "is:open is:pr review-requested:@me archived:false"
      ) {
        issueCount
        nodes {
          ...WorkFields
        }
      }
      myPrs: search(type: ISSUE, first: 50, query: "is:open is:pr author:@me archived:false") {
        issueCount
        nodes {
          ...WorkFields
        }
      }
      assigned: search(type: ISSUE, first: 50, query: "is:open assignee:@me archived:false") {
        issueCount
        nodes {
          ...WorkFields
        }
      }
      ciFailing: search(
        type: ISSUE
        first: 50
        query: "is:open is:pr author:@me status:failure archived:false"
      ) {
        issueCount
        nodes {
          ...WorkFields
        }
      }
    }
  `,
  [workFields],
);
function checks(state: string | undefined): ChecksState {
  if (state === "SUCCESS") return "success";
  if (state === "FAILURE" || state === "ERROR") return "failure";
  return state ? "pending" : null;
}
function review(state: string | null): ReviewDecision {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changesRequested";
    case "REVIEW_REQUIRED":
      return "reviewRequired";
    default:
      return null;
  }
}
function mapSegment(segment: ResultOf<typeof workDocument>["assigned"]): WorkQueue["assigned"] {
  return {
    count: segment.issueCount,
    items: (segment.nodes ?? []).flatMap((subject) => {
      if (!subject || (subject.__typename !== "Issue" && subject.__typename !== "PullRequest"))
        return [];
      const pull = subject.__typename === "PullRequest";
      return [
        {
          kind: pull ? "pullRequest" : "issue",
          repo: { owner: subject.repository.owner.login, name: subject.repository.name },
          number: subject.number,
          title: subject.title,
          updatedAt: subject.updatedAt,
          author: subject.author,
          isDraft: pull && subject.isDraft,
          checks: pull ? checks(subject.commits.nodes?.[0]?.commit.statusCheckRollup?.state) : null,
          reviewDecision: pull ? review(subject.reviewDecision) : null,
        },
      ];
    }),
  };
}
export function useWorkQueue(): UseQueryResult<WorkQueue> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: accountKey(account.id, "work"),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }): Promise<WorkQueue> => {
      const response = await requestGraphQL(account.id, workDocument, {}, signal);
      return {
        reviewRequested: mapSegment(response.reviewRequested),
        myPrs: mapSegment(response.myPrs),
        assigned: mapSegment(response.assigned),
        ciFailing: mapSegment(response.ciFailing),
      };
    },
  });
}
