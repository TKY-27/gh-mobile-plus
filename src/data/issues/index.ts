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
import type { GitHubError } from "../errors";
import { graphql as requestGraphQL } from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { graphql } from "../internal/graphql";
import { nodesOf } from "../internal/connection";
import { checksState, closedReason } from "../internal/subject-status";
import { PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { useActiveAccount, type AccountId } from "../session";
import type { Actor, ChecksState, Label, Page, ReactionContent, ReactionGroup } from "../types";
import {
  conversationOptions,
  issueListsKey,
  timelineOptions,
  useConversationMutation,
  withSubject,
  type Conversation,
  type IssueDetail,
  type IssueState,
} from "./conversation";
import type { IssueTemplate } from "./forms";
import {
  assignableOptions,
  idsByName,
  labelsOptions,
  repositoryKey,
  resolveIds,
  type RepositoryLabels,
  type UserRecord,
} from "./repository-options";
import type { TimelineItem } from "./timeline";

export type { IssueDetail, IssueState } from "./conversation";
export {
  issueFormDefaults,
  issueFormToMarkdown,
  missingRequiredIssueFields,
  type IssueFormField,
  type IssueTemplate,
} from "./forms";
export type { TimelineItem } from "./timeline";

export interface IssueListItem {
  number: number;
  title: string;
  state: IssueState | "merged";
  isDraft: boolean;
  closedReason?: "completed" | "notPlanned" | null;
  author: Actor | null;
  labels: readonly Label[];
  comments: number;
  updatedAt: string;
  checks: ChecksState;
}

const LIST_PAGE_SIZE = 30;

const issueListDocument = graphql(`
  query IssueList(
    $owner: String!
    $repo: String!
    $cursor: String
    $count: Int!
    $issues: Boolean!
    $issueStates: [IssueState!]
    $pullStates: [PullRequestState!]
  ) {
    repository(owner: $owner, name: $repo) {
      issues(
        first: $count
        after: $cursor
        states: $issueStates
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) @include(if: $issues) {
        nodes {
          number
          title
          state
          stateReason
          updatedAt
          author {
            login
            avatarUrl
          }
          labels(first: 10) {
            nodes {
              name
              color
              description
            }
          }
          comments {
            totalCount
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
      pullRequests(
        first: $count
        after: $cursor
        states: $pullStates
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) @skip(if: $issues) {
        nodes {
          number
          title
          state
          isDraft
          updatedAt
          author {
            login
            avatarUrl
          }
          labels(first: 10) {
            nodes {
              name
              color
              description
            }
          }
          comments {
            totalCount
          }
          statusCheckRollup {
            state
          }
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

const milestonesDocument = graphql(`
  query Milestones($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      milestones(first: 100, states: [OPEN], orderBy: { field: DUE_DATE, direction: ASC }) {
        nodes {
          id
          title
          dueOn
        }
      }
    }
  }
`);

const mentionCandidatesDocument = graphql(`
  query MentionCandidates(
    $owner: String!
    $repo: String!
    $number: Int!
    $withParticipants: Boolean!
  ) {
    repository(owner: $owner, name: $repo) {
      assignableUsers(first: 100) {
        nodes {
          login
          avatarUrl
        }
      }
      issueOrPullRequest(number: $number) @include(if: $withParticipants) {
        __typename
        ... on Issue {
          participants(first: 100) {
            nodes {
              login
              avatarUrl
            }
          }
        }
        ... on PullRequest {
          participants(first: 100) {
            nodes {
              login
              avatarUrl
            }
          }
        }
      }
    }
  }
`);

const referenceCandidatesDocument = graphql(`
  query ReferenceCandidates($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      issues(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          updatedAt
        }
      }
      pullRequests(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          number
          title
          updatedAt
        }
      }
    }
  }
`);

const issueTemplatesDocument = graphql(`
  query IssueTemplates($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: "HEAD:.github/ISSUE_TEMPLATE") {
        __typename
        ... on Tree {
          entries {
            name
            type
            object {
              __typename
              ... on Blob {
                text
              }
            }
          }
        }
      }
    }
  }
`);

const subjectAssignmentDocument = graphql(`
  query SubjectAssignment($id: ID!) {
    node(id: $id) {
      __typename
      ... on Issue {
        labels(first: 100) {
          nodes {
            id
            name
          }
        }
        assignees(first: 20) {
          nodes {
            id
            login
          }
        }
      }
      ... on PullRequest {
        labels(first: 100) {
          nodes {
            id
            name
          }
        }
        assignees(first: 20) {
          nodes {
            id
            login
          }
        }
      }
    }
  }
`);

const addCommentDocument = graphql(`
  mutation AddComment($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      clientMutationId
    }
  }
`);

const addLabelsDocument = graphql(`
  mutation AddLabels($id: ID!, $labelIds: [ID!]!) {
    addLabelsToLabelable(input: { labelableId: $id, labelIds: $labelIds }) {
      clientMutationId
    }
  }
`);

const removeLabelsDocument = graphql(`
  mutation RemoveLabels($id: ID!, $labelIds: [ID!]!) {
    removeLabelsFromLabelable(input: { labelableId: $id, labelIds: $labelIds }) {
      clientMutationId
    }
  }
`);

const addAssigneesDocument = graphql(`
  mutation AddAssignees($id: ID!, $assigneeIds: [ID!]!) {
    addAssigneesToAssignable(input: { assignableId: $id, assigneeIds: $assigneeIds }) {
      clientMutationId
    }
  }
`);

const removeAssigneesDocument = graphql(`
  mutation RemoveAssignees($id: ID!, $assigneeIds: [ID!]!) {
    removeAssigneesFromAssignable(input: { assignableId: $id, assigneeIds: $assigneeIds }) {
      clientMutationId
    }
  }
`);

const issueMilestoneDocument = graphql(`
  mutation SetIssueMilestone($id: ID!, $milestoneId: ID) {
    updateIssue(input: { id: $id, milestoneId: $milestoneId }) {
      clientMutationId
    }
  }
`);

const pullRequestMilestoneDocument = graphql(`
  mutation SetPullRequestMilestone($id: ID!, $milestoneId: ID) {
    updatePullRequest(input: { pullRequestId: $id, milestoneId: $milestoneId }) {
      clientMutationId
    }
  }
`);

const closeIssueDocument = graphql(`
  mutation CloseIssue($id: ID!, $stateReason: IssueClosedStateReason!) {
    closeIssue(input: { issueId: $id, stateReason: $stateReason }) {
      clientMutationId
    }
  }
`);

const reopenIssueDocument = graphql(`
  mutation ReopenIssue($id: ID!) {
    reopenIssue(input: { issueId: $id }) {
      clientMutationId
    }
  }
`);

const closePullRequestDocument = graphql(`
  mutation ClosePullRequest($id: ID!) {
    closePullRequest(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`);

const reopenPullRequestDocument = graphql(`
  mutation ReopenPullRequest($id: ID!) {
    reopenPullRequest(input: { pullRequestId: $id }) {
      clientMutationId
    }
  }
`);

const lockDocument = graphql(`
  mutation Lock($id: ID!) {
    lockLockable(input: { lockableId: $id }) {
      clientMutationId
    }
  }
`);

const unlockDocument = graphql(`
  mutation Unlock($id: ID!) {
    unlockLockable(input: { lockableId: $id }) {
      clientMutationId
    }
  }
`);

const subscriptionDocument = graphql(`
  mutation SetSubscription($id: ID!, $state: SubscriptionState!) {
    updateSubscription(input: { subscribableId: $id, state: $state }) {
      clientMutationId
    }
  }
`);

const addReactionDocument = graphql(`
  mutation AddReaction($id: ID!, $content: ReactionContent!) {
    addReaction(input: { subjectId: $id, content: $content }) {
      clientMutationId
    }
  }
`);

const removeReactionDocument = graphql(`
  mutation RemoveReaction($id: ID!, $content: ReactionContent!) {
    removeReaction(input: { subjectId: $id, content: $content }) {
      clientMutationId
    }
  }
`);

const createIssueDocument = graphql(`
  mutation CreateIssue($repositoryId: ID!, $title: String!, $body: String!, $labelIds: [ID!]) {
    createIssue(
      input: { repositoryId: $repositoryId, title: $title, body: $body, labelIds: $labelIds }
    ) {
      issue {
        number
      }
    }
  }
`);

type ListRepository = NonNullable<ResultOf<typeof issueListDocument>["repository"]>;

function mapListPage(repository: ListRepository): Page<IssueListItem> {
  const connection = repository.issues ?? repository.pullRequests;
  const issues = nodesOf(repository.issues).map((issue): IssueListItem => ({
    number: issue.number,
    title: issue.title,
    state: issue.state === "OPEN" ? "open" : "closed",
    isDraft: false,
    closedReason: closedReason(issue.stateReason),
    author: issue.author,
    labels: nodesOf(issue.labels),
    comments: issue.comments.totalCount,
    updatedAt: issue.updatedAt,
    checks: null,
  }));
  const pulls = nodesOf(repository.pullRequests).map((pull): IssueListItem => ({
    number: pull.number,
    title: pull.title,
    state: pull.state === "OPEN" ? "open" : pull.state === "MERGED" ? "merged" : "closed",
    isDraft: pull.isDraft,
    author: pull.author,
    labels: nodesOf(pull.labels),
    comments: pull.comments.totalCount,
    updatedAt: pull.updatedAt,
    checks: checksState(pull.statusCheckRollup?.state),
  }));
  return {
    items: [...issues, ...pulls],
    nextCursor: connection?.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
  };
}

export function useIssueList(
  owner: string,
  repo: string,
  kind: "issues" | "pulls",
  state: "open" | "closed",
): UseInfiniteQueryResult<InfiniteData<Page<IssueListItem>>> {
  const account = useActiveAccount();
  return useInfiniteQuery({
    queryKey: [...issueListsKey(account.id), owner.toLowerCase(), repo.toLowerCase(), kind, state],
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const response = await requestGraphQL(
        account.id,
        issueListDocument,
        {
          owner,
          repo,
          cursor: pageParam,
          count: LIST_PAGE_SIZE,
          issues: kind === "issues",
          issueStates: [state === "open" ? "OPEN" : "CLOSED"],
          pullStates: state === "open" ? ["OPEN"] : ["CLOSED", "MERGED"],
        },
        signal,
      );
      if (!response.repository) throw gitHubFailure({ kind: "notFound" });
      return mapListPage(response.repository);
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

function selectIssue(conversation: Conversation): IssueDetail {
  // Issue URLs may identify pull requests.
  if (conversation.kind !== "issue") throw gitHubFailure({ kind: "notFound" });
  return conversation.detail;
}

export function useIssue(owner: string, repo: string, number: number): UseQueryResult<IssueDetail> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useQuery({
    ...conversationOptions(account.id, queryClient, owner, repo, number),
    select: selectIssue,
  });
}

export function useTimeline(
  owner: string,
  repo: string,
  number: number,
): UseInfiniteQueryResult<InfiniteData<Page<TimelineItem>>> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useInfiniteQuery(timelineOptions(account.id, queryClient, owner, repo, number));
}

function toLabel({ name, color, description }: Label): Label {
  return { name, color, description };
}

function toActor({ login, avatarUrl }: Actor): Actor {
  return { login, avatarUrl };
}

function selectLabels(repository: RepositoryLabels): readonly Label[] {
  return repository.labels.map(toLabel);
}

function selectActors(users: readonly UserRecord[]): readonly Actor[] {
  return users.map(toActor);
}

export function useRepoLabels(owner: string, repo: string): UseQueryResult<readonly Label[]> {
  const account = useActiveAccount();
  return useQuery({ ...labelsOptions(account.id, owner, repo), select: selectLabels });
}

export function useAssignableUsers(owner: string, repo: string): UseQueryResult<readonly Actor[]> {
  const account = useActiveAccount();
  return useQuery({ ...assignableOptions(account.id, owner, repo), select: selectActors });
}

export function useMilestones(
  owner: string,
  repo: string,
): UseQueryResult<readonly { id: string; title: string; dueOn: string | null }[]> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: repositoryKey(account.id, "milestones", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const response = await requestGraphQL(
        account.id,
        milestonesDocument,
        { owner, repo },
        signal,
      );
      if (!response.repository) throw gitHubFailure({ kind: "notFound" });
      return nodesOf(response.repository.milestones);
    },
  });
}

export function useMentionCandidates(
  owner: string,
  repo: string,
  number: number | null,
): UseQueryResult<readonly Actor[]> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: [...repositoryKey(account.id, "mentionCandidates", owner, repo), number],
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const response = await requestGraphQL(
        account.id,
        mentionCandidatesDocument,
        { owner, repo, number: number ?? 0, withParticipants: number !== null },
        signal,
      );
      const repository = response.repository;
      if (!repository) throw gitHubFailure({ kind: "notFound" });
      const subject = repository.issueOrPullRequest;
      const participants =
        subject?.__typename === "Issue" || subject?.__typename === "PullRequest"
          ? nodesOf(subject.participants)
          : [];
      const byLogin = new Map<string, Actor>();
      for (const actor of [...participants, ...nodesOf(repository.assignableUsers)]) {
        if (!byLogin.has(actor.login)) byLogin.set(actor.login, actor);
      }
      return [...byLogin.values()];
    },
  });
}

export function useReferenceCandidates(
  owner: string,
  repo: string,
): UseQueryResult<readonly { number: number; title: string; isPullRequest: boolean }[]> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: repositoryKey(account.id, "referenceCandidates", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const response = await requestGraphQL(
        account.id,
        referenceCandidatesDocument,
        { owner, repo },
        signal,
      );
      if (!response.repository) throw gitHubFailure({ kind: "notFound" });
      const references = [
        ...nodesOf(response.repository.issues).map((issue) => ({ ...issue, isPullRequest: false })),
        ...nodesOf(response.repository.pullRequests).map((pull) => ({
          ...pull,
          isPullRequest: true,
        })),
      ];
      return references
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(({ number, title, isPullRequest }) => ({ number, title, isPullRequest }));
    },
  });
}

export function useIssueTemplates(
  owner: string,
  repo: string,
): UseQueryResult<readonly IssueTemplate[]> {
  const account = useActiveAccount();
  return useQuery({
    queryKey: repositoryKey(account.id, "issueTemplates", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const response = await requestGraphQL(
        account.id,
        issueTemplatesDocument,
        { owner, repo },
        signal,
      );
      if (!response.repository) throw gitHubFailure({ kind: "notFound" });
      const tree = response.repository.object;
      if (tree?.__typename !== "Tree") return [];
      // Lazy loading excludes YAML from startup.
      const { parseIssueTemplate } = await import("./templates");
      return (tree.entries ?? []).flatMap((entry) => {
        const text = entry.object?.__typename === "Blob" ? entry.object.text : null;
        if (entry.type !== "blob" || text === null) return [];
        const template = parseIssueTemplate(entry.name, text);
        return template ? [template] : [];
      });
    },
  });
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const excluded = new Set(right.map((name) => name.toLowerCase()));
  return left.filter((name) => !excluded.has(name.toLowerCase()));
}

async function currentAssignment(accountId: AccountId, subjectId: string) {
  const response = await requestGraphQL(accountId, subjectAssignmentDocument, { id: subjectId });
  const node = response.node;
  if (node?.__typename !== "Issue" && node?.__typename !== "PullRequest") {
    throw gitHubFailure({ kind: "notFound" });
  }
  return { labels: nodesOf(node.labels), assignees: nodesOf(node.assignees) };
}

export function useAddComment(): UseMutationResult<
  void,
  GitHubError,
  { subjectId: string; body: string }
> {
  const account = useActiveAccount();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    mutationFn: async ({ subjectId, body }) => {
      await requestGraphQL(account.id, addCommentDocument, { subjectId, body });
    },
  });
}

export function useSetLabels(): UseMutationResult<
  void,
  GitHubError,
  { subjectId: string; owner: string; repo: string; number: number; labelNames: readonly string[] }
> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    affectsLists: true,
    edit: ({ owner, repo, labelNames }) => {
      const known = queryClient.getQueryData<RepositoryLabels>(
        labelsOptions(account.id, owner, repo).queryKey,
      );
      return {
        conversation: (conversation) => {
          const labels = [...(known?.labels.map(toLabel) ?? []), ...conversation.detail.labels];
          return withSubject(conversation, {
            labels: labelNames.flatMap(
              (name) =>
                labels.find((label) => label.name.toLowerCase() === name.toLowerCase()) ?? [],
            ),
          });
        },
      };
    },
    mutationFn: async ({ subjectId, owner, repo, labelNames }) => {
      const [repository, current] = await Promise.all([
        queryClient.query({ ...labelsOptions(account.id, owner, repo), staleTime: "static" }),
        currentAssignment(account.id, subjectId),
      ]);
      const currentNames = current.labels.map((label) => label.name);
      const added = resolveIds(
        idsByName(repository.labels, (label) => label.name),
        difference(labelNames, currentNames),
        "labelNames",
      );
      const removed = resolveIds(
        idsByName(current.labels, (label) => label.name),
        difference(currentNames, labelNames),
        "labelNames",
      );
      if (added.length > 0) {
        await requestGraphQL(account.id, addLabelsDocument, { id: subjectId, labelIds: added });
      }
      if (removed.length > 0) {
        await requestGraphQL(account.id, removeLabelsDocument, {
          id: subjectId,
          labelIds: removed,
        });
      }
    },
  });
}

export function useSetAssignees(): UseMutationResult<
  void,
  GitHubError,
  { subjectId: string; owner: string; repo: string; number: number; logins: readonly string[] }
> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    affectsLists: true,
    edit: ({ owner, repo, logins }) => {
      const known = queryClient.getQueryData<readonly UserRecord[]>(
        assignableOptions(account.id, owner, repo).queryKey,
      );
      return {
        conversation: (conversation) => {
          const actors = [...(known?.map(toActor) ?? []), ...conversation.detail.assignees];
          return withSubject(conversation, {
            assignees: logins.flatMap(
              (login) =>
                actors.find((actor) => actor.login.toLowerCase() === login.toLowerCase()) ?? [],
            ),
          });
        },
      };
    },
    mutationFn: async ({ subjectId, owner, repo, logins }) => {
      const [assignable, current] = await Promise.all([
        queryClient.query({ ...assignableOptions(account.id, owner, repo), staleTime: "static" }),
        currentAssignment(account.id, subjectId),
      ]);
      const currentLogins = current.assignees.map((assignee) => assignee.login);
      const ids = idsByName([...assignable, ...current.assignees], (user) => user.login);
      const added = resolveIds(ids, difference(logins, currentLogins), "logins");
      const removed = resolveIds(ids, difference(currentLogins, logins), "logins");
      if (added.length > 0) {
        await requestGraphQL(account.id, addAssigneesDocument, {
          id: subjectId,
          assigneeIds: added,
        });
      }
      if (removed.length > 0) {
        await requestGraphQL(account.id, removeAssigneesDocument, {
          id: subjectId,
          assigneeIds: removed,
        });
      }
    },
  });
}

export function useSetMilestone(): UseMutationResult<
  void,
  GitHubError,
  { subjectId: string; owner: string; repo: string; number: number; milestoneId: string | null }
> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    edit: ({ owner, repo, milestoneId }) => {
      const milestones = queryClient.getQueryData<readonly { id: string; title: string }[]>(
        repositoryKey(account.id, "milestones", owner, repo),
      );
      const milestone = milestones?.find((candidate) => candidate.id === milestoneId);
      if (milestoneId !== null && !milestone) return {};
      return {
        conversation: (conversation) =>
          withSubject(conversation, {
            milestone: milestone ? { id: milestone.id, title: milestone.title } : null,
          }),
      };
    },
    mutationFn: async ({ subjectId, owner, repo, number, milestoneId }) => {
      const conversation = await queryClient.query({
        ...conversationOptions(account.id, queryClient, owner, repo, number),
        staleTime: "static",
      });
      const variables = { id: subjectId, milestoneId };
      if (conversation.kind === "issue") {
        await requestGraphQL(account.id, issueMilestoneDocument, variables);
      } else {
        await requestGraphQL(account.id, pullRequestMilestoneDocument, variables);
      }
    },
  });
}

function withState(
  conversation: Conversation,
  state: "open" | "closed",
  reason: "completed" | "notPlanned" | undefined,
): Conversation {
  if (conversation.kind === "issue") {
    const stateReason = state === "open" ? "reopened" : (reason ?? "completed");
    return { ...conversation, detail: { ...conversation.detail, state, stateReason } };
  }
  if (conversation.detail.state === "merged") return conversation;
  return { ...conversation, detail: { ...conversation.detail, state } };
}

export function useSetIssueState(): UseMutationResult<
  void,
  GitHubError,
  {
    subjectId: string;
    owner: string;
    repo: string;
    number: number;
    state: "open" | "closed";
    reason?: "completed" | "notPlanned";
  }
> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    affectsLists: true,
    edit: ({ state, reason }) => ({
      conversation: (conversation) => withState(conversation, state, reason),
    }),
    mutationFn: async ({ subjectId: id, owner, repo, number, state, reason }) => {
      const conversation = await queryClient.query({
        ...conversationOptions(account.id, queryClient, owner, repo, number),
        staleTime: "static",
      });
      if (conversation.kind === "pullRequest") {
        await (state === "open"
          ? requestGraphQL(account.id, reopenPullRequestDocument, { id })
          : requestGraphQL(account.id, closePullRequestDocument, { id }));
      } else if (state === "open") {
        await requestGraphQL(account.id, reopenIssueDocument, { id });
      } else {
        const stateReason = reason === "notPlanned" ? "NOT_PLANNED" : "COMPLETED";
        await requestGraphQL(account.id, closeIssueDocument, { id, stateReason });
      }
    },
  });
}

export function useSetLocked(): UseMutationResult<
  void,
  GitHubError,
  { subjectId: string; locked: boolean }
> {
  const account = useActiveAccount();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    edit: ({ locked }) => ({
      conversation: (conversation) => withSubject(conversation, { locked }),
    }),
    mutationFn: async ({ subjectId: id, locked }) => {
      await (locked
        ? requestGraphQL(account.id, lockDocument, { id })
        : requestGraphQL(account.id, unlockDocument, { id }));
    },
  });
}

export function useSetSubscribed(): UseMutationResult<
  void,
  GitHubError,
  { subjectId: string; subscribed: boolean }
> {
  const account = useActiveAccount();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    edit: ({ subscribed }) => ({
      conversation: (conversation) => withSubject(conversation, { viewerSubscribed: subscribed }),
    }),
    mutationFn: async ({ subjectId: id, subscribed }) => {
      await requestGraphQL(account.id, subscriptionDocument, {
        id,
        state: subscribed ? "SUBSCRIBED" : "UNSUBSCRIBED",
      });
    },
  });
}

function toggleReaction(
  groups: readonly ReactionGroup[],
  content: ReactionContent,
  add: boolean,
): readonly ReactionGroup[] {
  const group = groups.find((candidate) => candidate.content === content);
  if (!group) return add ? [...groups, { content, count: 1, viewerHasReacted: true }] : groups;
  if (group.viewerHasReacted === add) return groups;
  return groups.map((candidate) =>
    candidate === group
      ? { content, count: Math.max(0, group.count + (add ? 1 : -1)), viewerHasReacted: add }
      : candidate,
  );
}

export function useToggleReaction(): UseMutationResult<
  void,
  GitHubError,
  { subjectId: string; content: ReactionContent; add: boolean }
> {
  const account = useActiveAccount();
  return useConversationMutation({
    subjectId: (variables) => variables.subjectId,
    edit: ({ content, add }) => ({
      conversation: (conversation) =>
        withSubject(conversation, {
          reactions: toggleReaction(conversation.detail.reactions, content, add),
        }),
      comment: (comment) => ({
        ...comment,
        reactions: toggleReaction(comment.reactions, content, add),
      }),
    }),
    mutationFn: async ({ subjectId: id, content, add }) => {
      await (add
        ? requestGraphQL(account.id, addReactionDocument, { id, content })
        : requestGraphQL(account.id, removeReactionDocument, { id, content }));
    },
  });
}

export function useCreateIssue(): UseMutationResult<
  { number: number },
  GitHubError,
  { owner: string; repo: string; title: string; body: string; labels: readonly string[] }
> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ owner, repo, title, body, labels }) => {
      const repository = await queryClient.query({
        ...labelsOptions(account.id, owner, repo),
        staleTime: "static",
      });
      const ids = idsByName(repository.labels, (label) => label.name);
      // GitHub drops labels the repository lacks.
      const labelIds = labels.flatMap((name) => ids.get(name.toLowerCase()) ?? []);
      const response = await requestGraphQL(account.id, createIssueDocument, {
        repositoryId: repository.repositoryId,
        title,
        body,
        labelIds,
      });
      const issue = response.createIssue?.issue;
      if (!issue) throw gitHubFailure({ kind: "notFound" });
      return { number: issue.number };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: issueListsKey(account.id) }),
  });
}
