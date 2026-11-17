import { queryOptions } from "@tanstack/react-query";
import type { ResultOf } from "gql.tada";
import { graphql as requestGraphQL } from "../internal/client";
import { nodesOf } from "../internal/connection";
import { gitHubFailure } from "../internal/errors";
import { graphql } from "../internal/graphql";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import type { AccountId } from "../session";
import type { Actor, Label } from "../types";

export interface LabelRecord extends Label {
  id: string;
}
export interface RepositoryLabels {
  repositoryId: string;
  labels: readonly LabelRecord[];
}
export interface UserRecord extends Actor {
  id: string;
}

const LABELS_PAGE_SIZE = 100;

const labelsDocument = graphql(`
  query RepositoryLabels($owner: String!, $repo: String!, $cursor: String, $count: Int!) {
    repository(owner: $owner, name: $repo) {
      id
      labels(first: $count, after: $cursor, orderBy: { field: NAME, direction: ASC }) {
        nodes {
          id
          name
          color
          description
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

const assignableUsersDocument = graphql(`
  query AssignableUsers($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      assignableUsers(first: 100) {
        nodes {
          id
          login
          avatarUrl
        }
      }
    }
  }
`);

// Route casing differs from GitHub's canonical names.
export function repositoryKey(accountId: AccountId, area: string, owner: string, repo: string) {
  return accountKey(accountId, area, owner.toLowerCase(), repo.toLowerCase());
}

export function subjectKey(
  accountId: AccountId,
  area: string,
  owner: string,
  repo: string,
  number: number,
) {
  return accountKey(accountId, area, owner.toLowerCase(), repo.toLowerCase(), number);
}

export function labelsOptions(accountId: AccountId, owner: string, repo: string) {
  return queryOptions({
    queryKey: repositoryKey(accountId, "labels", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }): Promise<RepositoryLabels> => {
      const labels: LabelRecord[] = [];
      let repositoryId: string;
      let cursor: string | null = null;
      do {
        const response: ResultOf<typeof labelsDocument> = await requestGraphQL(
          accountId,
          labelsDocument,
          { owner, repo, cursor, count: LABELS_PAGE_SIZE },
          signal,
        );
        if (!response.repository) throw gitHubFailure({ kind: "notFound" });
        repositoryId = response.repository.id;
        labels.push(...nodesOf(response.repository.labels));
        const pageInfo = response.repository.labels?.pageInfo;
        cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
      } while (cursor !== null);
      return { repositoryId, labels };
    },
  });
}

export function assignableOptions(accountId: AccountId, owner: string, repo: string) {
  return queryOptions({
    queryKey: repositoryKey(accountId, "assignableUsers", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }): Promise<readonly UserRecord[]> => {
      const response = await requestGraphQL(
        accountId,
        assignableUsersDocument,
        { owner, repo },
        signal,
      );
      if (!response.repository) throw gitHubFailure({ kind: "notFound" });
      return nodesOf(response.repository.assignableUsers);
    },
  });
}

export function idsByName<T extends { id: string }>(
  records: readonly T[],
  nameOf: (record: T) => string,
): Map<string, string> {
  return new Map(records.map((record) => [nameOf(record).toLowerCase(), record.id]));
}

export function resolveIds(
  ids: ReadonlyMap<string, string>,
  names: readonly string[],
  field: string,
): string[] {
  const missing = names.filter((name) => !ids.has(name.toLowerCase()));
  if (missing.length > 0) {
    throw gitHubFailure({
      kind: "validation",
      message: `Unknown ${field}: ${missing.join(", ")}`,
      fields: [field],
    });
  }
  return names.flatMap((name) => ids.get(name.toLowerCase()) ?? []);
}
