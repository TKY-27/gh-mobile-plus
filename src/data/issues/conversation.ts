import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { ResultOf } from "gql.tada";
import type { GitHubError } from "../errors";
import { graphql as requestGraphQL } from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { graphql } from "../internal/graphql";
import { closedReason } from "../internal/subject-status";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import {
  mapPullRequest,
  mergeSettingsFragment,
  pullRequestFragment,
  type PullRequestDetail,
} from "../pulls/detail";
import { useActiveAccount, type AccountId } from "../session";
import type { Actor, Label, Page, ReactionGroup, RepoRef } from "../types";
import { subjectKey } from "./repository-options";
import {
  issueTimelineFragment,
  mapReactionGroups,
  mapTimelinePage,
  pullRequestTimelineFragment,
  reactionGroupsFragment,
  type TimelineItem,
} from "./timeline";

export type IssueState = "open" | "closed";

export interface IssueDetail {
  id: string;
  repo: RepoRef;
  number: number;
  title: string;
  state: IssueState;
  stateReason: "completed" | "notPlanned" | "reopened" | null;
  author: Actor | null;
  bodyHtml: string;
  createdAt: string;
  reactions: readonly ReactionGroup[];
  labels: readonly Label[];
  assignees: readonly Actor[];
  milestone: { id: string; title: string } | null;
  locked: boolean;
  viewerSubscribed: boolean;
  viewerCan: { update: boolean; close: boolean; lock: boolean; react: boolean; comment: boolean };
  webUrl: string;
}

export type SubjectDetail = Omit<IssueDetail, "state" | "stateReason">;

export type Conversation =
  | { kind: "issue"; detail: IssueDetail; timeline: Page<TimelineItem> }
  | { kind: "pullRequest"; detail: PullRequestDetail; timeline: Page<TimelineItem> };

type TimelineData = InfiniteData<Page<TimelineItem>, string | null>;
type CommentItem = Extract<TimelineItem, { kind: "comment" }>;

const repositoryAccessFragment = graphql(`
  fragment RepositoryAccessFields on Repository @_unmask {
    name
    owner {
      login
    }
    isArchived
    viewerPermission
  }
`);

const subjectFragment = graphql(
  `
    fragment SubjectFields on Node @_unmask {
      id
      ... on Comment {
        author {
          login
          avatarUrl
        }
        bodyHTML
        createdAt
      }
      ...ReactionGroupFields
      ... on Labelable {
        viewerCanLabel
        labels(first: 100) {
          nodes {
            name
            color
            description
          }
        }
      }
      ... on Assignable {
        assignees(first: 20) {
          nodes {
            login
            avatarUrl
          }
        }
      }
      ... on Lockable {
        locked
      }
      ... on Subscribable {
        viewerSubscription
      }
      ... on Closable {
        viewerCanClose
        viewerCanReopen
      }
      ... on UniformResourceLocatable {
        url
      }
    }
  `,
  [reactionGroupsFragment],
);

const conversationDocument = graphql(
  `
    query Conversation($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        ...RepositoryAccessFields
        ...MergeSettingsFields
        issueOrPullRequest(number: $number) {
          __typename
          ...SubjectFields
          ... on Issue {
            number
            title
            issueState: state
            stateReason
            milestone {
              id
              title
            }
            ...IssueTimelineFields
          }
          ... on PullRequest {
            number
            title
            milestone {
              id
              title
            }
            ...PullRequestDetailFields
            ...PullRequestTimelineFields
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
  [
    repositoryAccessFragment,
    mergeSettingsFragment,
    subjectFragment,
    issueTimelineFragment,
    pullRequestFragment,
    pullRequestTimelineFragment,
  ],
);

const timelinePageDocument = graphql(
  `
    query TimelinePage($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        issueOrPullRequest(number: $number) {
          __typename
          ... on Issue {
            ...IssueTimelineFields
          }
          ... on PullRequest {
            ...PullRequestTimelineFields
          }
        }
      }
    }
  `,
  [issueTimelineFragment, pullRequestTimelineFragment],
);

type ConversationRepository = NonNullable<ResultOf<typeof conversationDocument>["repository"]>;
type ConversationSubject = Extract<
  NonNullable<ConversationRepository["issueOrPullRequest"]>,
  { __typename: "Issue" | "PullRequest" }
>;

const PUSH_PERMISSIONS: ReadonlySet<ConversationRepository["viewerPermission"]> = new Set([
  "WRITE",
  "MAINTAIN",
  "ADMIN",
]);
// Moderation rights differ by subject type.
const ISSUE_LOCK_PERMISSIONS: ReadonlySet<ConversationRepository["viewerPermission"]> = new Set([
  ...PUSH_PERMISSIONS,
  "MODERATE",
]);

function mapSubject(
  subject: ConversationSubject,
  repository: ConversationRepository,
  isOpen: boolean,
): SubjectDetail {
  const canPush = PUSH_PERMISSIONS.has(repository.viewerPermission);
  const lockPermissions =
    subject.__typename === "Issue" ? ISSUE_LOCK_PERMISSIONS : PUSH_PERMISSIONS;
  return {
    id: subject.id,
    repo: { owner: repository.owner.login, name: repository.name },
    number: subject.number,
    title: subject.title,
    author: subject.author,
    bodyHtml: subject.bodyHTML,
    createdAt: subject.createdAt,
    reactions: mapReactionGroups(subject.reactionGroups),
    labels: (subject.labels?.nodes ?? []).flatMap((label) => (label ? [label] : [])),
    assignees: (subject.assignees.nodes ?? []).flatMap((assignee) => (assignee ? [assignee] : [])),
    milestone: subject.milestone,
    locked: subject.locked,
    viewerSubscribed: subject.viewerSubscription === "SUBSCRIBED",
    viewerCan: {
      // Metadata edits need triage, like labeling.
      update: subject.viewerCanLabel && !repository.isArchived,
      close: isOpen ? subject.viewerCanClose : subject.viewerCanReopen,
      lock: !repository.isArchived && lockPermissions.has(repository.viewerPermission),
      react: subject.viewerCanReact,
      comment: !repository.isArchived && (!subject.locked || canPush),
    },
    webUrl: subject.url,
  };
}

export function mapConversation(repository: ConversationRepository | null): Conversation {
  const subject = repository?.issueOrPullRequest;
  if (!repository || !subject) throw gitHubFailure({ kind: "notFound" });
  if (subject.__typename === "Issue") {
    const isOpen = subject.issueState === "OPEN";
    return {
      kind: "issue",
      detail: {
        ...mapSubject(subject, repository, isOpen),
        state: isOpen ? "open" : "closed",
        stateReason:
          subject.stateReason === "REOPENED" ? "reopened" : closedReason(subject.stateReason),
      },
      timeline: mapTimelinePage(subject.timelineItems),
    };
  }
  const writable = !repository.isArchived;
  return {
    kind: "pullRequest",
    detail: mapPullRequest(
      mapSubject(subject, repository, subject.state === "OPEN"),
      subject,
      repository,
      { canPush: writable && PUSH_PERMISSIONS.has(repository.viewerPermission), writable },
    ),
    timeline: mapTimelinePage(subject.timelineItems),
  };
}

function conversationKey(accountId: AccountId, owner: string, repo: string, number: number) {
  return subjectKey(accountId, "conversation", owner, repo, number);
}

function timelineKey(accountId: AccountId, owner: string, repo: string, number: number) {
  return subjectKey(accountId, "timeline", owner, repo, number);
}

export function issueListsKey(accountId: AccountId) {
  return accountKey(accountId, "issueList");
}

function seedTimeline(
  queryClient: QueryClient,
  key: ReturnType<typeof timelineKey>,
  first: Page<TimelineItem>,
): void {
  queryClient.setQueryData<TimelineData>(key, (current) =>
    current
      ? { pages: [first, ...current.pages.slice(1)], pageParams: current.pageParams }
      : { pages: [first], pageParams: [null] },
  );
}

export function conversationOptions(
  accountId: AccountId,
  queryClient: QueryClient,
  owner: string,
  repo: string,
  number: number,
) {
  return queryOptions({
    queryKey: conversationKey(accountId, owner, repo, number),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }): Promise<Conversation> => {
      const response = await requestGraphQL(
        accountId,
        conversationDocument,
        { owner, repo, number, cursor: null },
        signal,
      );
      const conversation = mapConversation(response.repository);
      seedTimeline(queryClient, timelineKey(accountId, owner, repo, number), conversation.timeline);
      return conversation;
    },
  });
}

export function timelineOptions(
  accountId: AccountId,
  queryClient: QueryClient,
  owner: string,
  repo: string,
  number: number,
) {
  const conversation = conversationOptions(accountId, queryClient, owner, repo, number);
  return infiniteQueryOptions({
    queryKey: timelineKey(accountId, owner, repo, number),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<Page<TimelineItem>> => {
      if (pageParam === null) {
        // Avoid duplicate conversation requests.
        const fetching =
          queryClient.getQueryState(conversation.queryKey)?.fetchStatus === "fetching";
        const loaded = await queryClient.query({
          ...conversation,
          staleTime: fetching ? 0 : STALE_TIME.detail,
        });
        return loaded.timeline;
      }
      const response = await requestGraphQL(
        accountId,
        timelinePageDocument,
        { owner, repo, number, cursor: pageParam },
        signal,
      );
      const subject = response.repository?.issueOrPullRequest;
      if (subject?.__typename !== "Issue" && subject?.__typename !== "PullRequest") {
        throw gitHubFailure({ kind: "notFound" });
      }
      return mapTimelinePage(subject.timelineItems);
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

export function withSubject(
  conversation: Conversation,
  patch: Partial<
    Pick<
      SubjectDetail,
      "labels" | "assignees" | "milestone" | "locked" | "viewerSubscribed" | "reactions"
    >
  >,
): Conversation {
  return conversation.kind === "issue"
    ? { ...conversation, detail: { ...conversation.detail, ...patch } }
    : { ...conversation, detail: { ...conversation.detail, ...patch } };
}

export interface ConversationEdit {
  conversation?: (conversation: Conversation) => Conversation;
  comment?: (comment: CommentItem) => CommentItem;
}

function containsItem(page: Page<TimelineItem>, subjectId: string): boolean {
  return page.items.some((entry) => entry.id === subjectId);
}

function editPage(
  page: Page<TimelineItem>,
  subjectId: string,
  edit: ConversationEdit,
): Page<TimelineItem> {
  const { comment } = edit;
  if (!comment || !containsItem(page, subjectId)) return page;
  return {
    ...page,
    items: page.items.map((entry) =>
      entry.id === subjectId && entry.kind === "comment" ? comment(entry) : entry,
    ),
  };
}

function editConversation(
  conversation: Conversation,
  subjectId: string,
  edit: ConversationEdit,
): Conversation {
  const edited =
    conversation.detail.id === subjectId && edit.conversation
      ? edit.conversation(conversation)
      : conversation;
  return { ...edited, timeline: editPage(edited.timeline, subjectId, edit) };
}

interface AffectedQueries {
  conversations: QueryKey[];
  timelines: QueryKey[];
}

function affectedQueries(
  queryClient: QueryClient,
  accountId: AccountId,
  subjectId: string,
): AffectedQueries {
  const conversations = queryClient
    .getQueriesData<Conversation>({ queryKey: accountKey(accountId, "conversation") })
    .filter(
      ([, conversation]) =>
        conversation &&
        (conversation.detail.id === subjectId || containsItem(conversation.timeline, subjectId)),
    );
  const pairedTimelines = new Set(
    conversations.flatMap(([, conversation]) =>
      conversation
        ? [
            JSON.stringify(
              timelineKey(
                accountId,
                conversation.detail.repo.owner,
                conversation.detail.repo.name,
                conversation.detail.number,
              ),
            ),
          ]
        : [],
    ),
  );
  const timelines = queryClient
    .getQueriesData<TimelineData>({ queryKey: accountKey(accountId, "timeline") })
    .filter(
      ([key, timeline]) =>
        pairedTimelines.has(JSON.stringify(key)) ||
        timeline?.pages.some((page) => containsItem(page, subjectId)),
    );
  return {
    conversations: conversations.map(([key]) => key),
    timelines: timelines.map(([key]) => key),
  };
}

export function useConversationMutation<Variables, Result>(options: {
  subjectId: (variables: Variables) => string;
  mutationFn: (variables: Variables) => Promise<Result>;
  edit?: (variables: Variables) => ConversationEdit;
  affectsLists?: boolean;
}): UseMutationResult<Result, GitHubError, Variables> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: options.mutationFn,
    onMutate: async (variables) => {
      const subjectId = options.subjectId(variables);
      const affected = affectedQueries(queryClient, account.id, subjectId);
      const edit = options.edit?.(variables);
      if (!edit) return { affected, snapshots: [] };
      const keys = [...affected.conversations, ...affected.timelines];
      await Promise.all(
        keys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true })),
      );
      const snapshots = keys.map((key) => [key, queryClient.getQueryData(key)] as const);
      for (const key of affected.conversations) {
        queryClient.setQueryData<Conversation>(
          key,
          (conversation) => conversation && editConversation(conversation, subjectId, edit),
        );
      }
      for (const key of affected.timelines) {
        queryClient.setQueryData<TimelineData>(
          key,
          (timeline) =>
            timeline && {
              ...timeline,
              pages: timeline.pages.map((page) => editPage(page, subjectId, edit)),
            },
        );
      }
      return { affected, snapshots };
    },
    onError: (_error, _variables, context) => {
      for (const [key, snapshot] of context?.snapshots ?? [])
        queryClient.setQueryData(key, snapshot);
    },
    onSettled: async (_result, _error, _variables, context) => {
      // Avoid refetching the conversation twice.
      const keys = [
        ...(context?.affected.conversations ?? []),
        ...(context?.affected.timelines ?? []),
      ];
      await Promise.all([
        ...keys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })),
        options.affectsLists
          ? queryClient.invalidateQueries({ queryKey: issueListsKey(account.id) })
          : null,
      ]);
    },
  });
}
