import type { ResultOf } from "gql.tada";
import { graphql } from "../internal/graphql";
import { closedReason } from "../internal/subject-status";
import type { Actor, Label, Page, ReactionGroup, RepoRef } from "../types";

export type TimelineItem =
  | {
      kind: "comment";
      id: string;
      author: Actor | null;
      bodyHtml: string;
      createdAt: string;
      reactions: readonly ReactionGroup[];
      viewerCanReact: boolean;
    }
  | {
      kind: "labeled" | "unlabeled";
      id: string;
      actor: Actor | null;
      label: Label;
      createdAt: string;
    }
  | {
      kind: "assigned" | "unassigned";
      id: string;
      actor: Actor | null;
      assignee: Actor | null;
      createdAt: string;
    }
  | {
      kind: "crossReferenced";
      id: string;
      actor: Actor | null;
      source: { repo: RepoRef; number: number; title: string; isPullRequest: boolean };
      createdAt: string;
    }
  | {
      kind: "commit";
      id: string;
      oid: string;
      headline: string;
      author: Actor | null;
      createdAt: string;
    }
  | {
      kind: "closed" | "reopened";
      id: string;
      actor: Actor | null;
      stateReason: "completed" | "notPlanned" | null;
      createdAt: string;
    }
  | {
      kind: "renamed";
      id: string;
      actor: Actor | null;
      from: string;
      to: string;
      createdAt: string;
    }
  | {
      kind: "review";
      id: string;
      author: Actor | null;
      state: "approved" | "changesRequested" | "commented" | "dismissed";
      bodyHtml: string;
      createdAt: string;
    }
  | { kind: "merged"; id: string; actor: Actor | null; createdAt: string }
  | { kind: "other"; id: string; typename: string; createdAt: string };

export const reactionGroupsFragment = graphql(`
  fragment ReactionGroupFields on Reactable @_unmask {
    viewerCanReact
    reactionGroups {
      content
      viewerHasReacted
      reactors {
        totalCount
      }
    }
  }
`);

export const timelineItemFragment = graphql(
  `
    fragment TimelineItemFields on Node @_unmask {
      __typename
      id
      ... on IssueComment {
        author {
          login
          avatarUrl
        }
        bodyHTML
        createdAt
        ...ReactionGroupFields
      }
      ... on LabeledEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
        label {
          name
          color
          description
        }
      }
      ... on UnlabeledEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
        label {
          name
          color
          description
        }
      }
      ... on AssignedEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
        assignee {
          ... on Actor {
            login
            avatarUrl
          }
        }
      }
      ... on UnassignedEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
        assignee {
          ... on Actor {
            login
            avatarUrl
          }
        }
      }
      ... on CrossReferencedEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
        source {
          __typename
          ... on Issue {
            number
            title
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
            repository {
              name
              owner {
                login
              }
            }
          }
        }
      }
      ... on PullRequestCommit {
        commit {
          oid
          messageHeadline
          committedDate
          author {
            user {
              login
              avatarUrl
            }
          }
        }
      }
      ... on ClosedEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
        stateReason
      }
      ... on ReopenedEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
      }
      ... on RenamedTitleEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
        previousTitle
        currentTitle
      }
      ... on PullRequestReview {
        author {
          login
          avatarUrl
        }
        createdAt
        submittedAt
        state
        bodyHTML
      }
      ... on MergedEvent {
        actor {
          login
          avatarUrl
        }
        createdAt
      }
    }
  `,
  [reactionGroupsFragment],
);

// Unlisted events would crowd the timeline.
export const issueTimelineFragment = graphql(
  `
    fragment IssueTimelineFields on Issue @_unmask {
      timelineItems(
        first: 50
        after: $cursor
        itemTypes: [
          ISSUE_COMMENT
          LABELED_EVENT
          UNLABELED_EVENT
          ASSIGNED_EVENT
          UNASSIGNED_EVENT
          CROSS_REFERENCED_EVENT
          CLOSED_EVENT
          REOPENED_EVENT
          RENAMED_TITLE_EVENT
        ]
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ...TimelineItemFields
        }
      }
    }
  `,
  [timelineItemFragment],
);

export const pullRequestTimelineFragment = graphql(
  `
    fragment PullRequestTimelineFields on PullRequest @_unmask {
      timelineItems(
        first: 50
        after: $cursor
        itemTypes: [
          ISSUE_COMMENT
          LABELED_EVENT
          UNLABELED_EVENT
          ASSIGNED_EVENT
          UNASSIGNED_EVENT
          CROSS_REFERENCED_EVENT
          CLOSED_EVENT
          REOPENED_EVENT
          RENAMED_TITLE_EVENT
          PULL_REQUEST_COMMIT
          PULL_REQUEST_REVIEW
          MERGED_EVENT
        ]
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ...TimelineItemFields
        }
      }
    }
  `,
  [timelineItemFragment],
);

type TimelineNode =
  ResultOf<typeof timelineItemFragment> | { __typename?: "PullRequestRevisionMarker" };
interface TimelineConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: readonly (TimelineNode | null)[] | null;
}

export function mapReactionGroups(
  groups: ResultOf<typeof reactionGroupsFragment>["reactionGroups"],
): ReactionGroup[] {
  return (groups ?? []).map((group) => ({
    content: group.content,
    count: group.reactors.totalCount,
    viewerHasReacted: group.viewerHasReacted,
  }));
}

function reviewState(
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING",
): "approved" | "changesRequested" | "commented" | "dismissed" | null {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changesRequested";
    case "COMMENTED":
      return "commented";
    case "DISMISSED":
      return "dismissed";
    case "PENDING":
      return null;
  }
}

function mapTimelineItem(node: TimelineNode): TimelineItem[] {
  switch (node.__typename) {
    case "IssueComment":
      return [
        {
          kind: "comment",
          id: node.id,
          author: node.author,
          bodyHtml: node.bodyHTML,
          createdAt: node.createdAt,
          reactions: mapReactionGroups(node.reactionGroups),
          viewerCanReact: node.viewerCanReact,
        },
      ];
    case "LabeledEvent":
    case "UnlabeledEvent":
      return [
        {
          kind: node.__typename === "LabeledEvent" ? "labeled" : "unlabeled",
          id: node.id,
          actor: node.actor,
          label: node.label,
          createdAt: node.createdAt,
        },
      ];
    case "AssignedEvent":
    case "UnassignedEvent":
      return [
        {
          kind: node.__typename === "AssignedEvent" ? "assigned" : "unassigned",
          id: node.id,
          actor: node.actor,
          assignee: node.assignee
            ? { login: node.assignee.login, avatarUrl: node.assignee.avatarUrl }
            : null,
          createdAt: node.createdAt,
        },
      ];
    case "CrossReferencedEvent":
      return [
        {
          kind: "crossReferenced",
          id: node.id,
          actor: node.actor,
          source: {
            repo: {
              owner: node.source.repository.owner.login,
              name: node.source.repository.name,
            },
            number: node.source.number,
            title: node.source.title,
            isPullRequest: node.source.__typename === "PullRequest",
          },
          createdAt: node.createdAt,
        },
      ];
    case "PullRequestCommit":
      return [
        {
          kind: "commit",
          id: node.id,
          oid: node.commit.oid,
          headline: node.commit.messageHeadline,
          author: node.commit.author?.user ?? null,
          createdAt: node.commit.committedDate,
        },
      ];
    case "ClosedEvent":
      return [
        {
          kind: "closed",
          id: node.id,
          actor: node.actor,
          stateReason: closedReason(node.stateReason),
          createdAt: node.createdAt,
        },
      ];
    case "ReopenedEvent":
      return [
        {
          kind: "reopened",
          id: node.id,
          actor: node.actor,
          stateReason: null,
          createdAt: node.createdAt,
        },
      ];
    case "RenamedTitleEvent":
      return [
        {
          kind: "renamed",
          id: node.id,
          actor: node.actor,
          from: node.previousTitle,
          to: node.currentTitle,
          createdAt: node.createdAt,
        },
      ];
    case "PullRequestReview": {
      const state = reviewState(node.state);
      if (state === null) return [];
      return [
        {
          kind: "review",
          id: node.id,
          author: node.author,
          state,
          bodyHtml: node.bodyHTML,
          createdAt: node.submittedAt ?? node.createdAt,
        },
      ];
    }
    case "MergedEvent":
      return [{ kind: "merged", id: node.id, actor: node.actor, createdAt: node.createdAt }];
    default:
      return [];
  }
}

export function mapTimelinePage(connection: TimelineConnection): Page<TimelineItem> {
  return {
    items: (connection.nodes ?? []).flatMap((node) => (node ? mapTimelineItem(node) : [])),
    nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
  };
}
