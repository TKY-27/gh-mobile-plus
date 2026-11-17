import type { QueryClient } from "@tanstack/react-query";
import { subjectKey } from "../issues/repository-options";
import type { AccountId } from "../session";

const SUGGESTION_AFFECTED: ReadonlySet<unknown> = new Set([
  "conversation",
  "timeline",
  "pullFiles",
  "reviewThreads",
]);

export function pullKey(
  accountId: AccountId,
  name: "pullFiles" | "reviewThreads",
  owner: string,
  repo: string,
  number: number,
) {
  return subjectKey(accountId, name, owner, repo, number);
}

export function invalidatePullQueries(
  client: QueryClient,
  accountId: AccountId,
  owner: string,
  repo: string,
  number: number,
): Promise<void> {
  const [, , ownerKey, repoKey] = subjectKey(accountId, "", owner, repo, number);
  return client.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === accountId &&
      queryKey[2] === ownerKey &&
      queryKey[3] === repoKey &&
      queryKey[4] === number,
  });
}

/** A commit may change any repository pull. */
export function invalidateRepositoryPulls(
  client: QueryClient,
  accountId: AccountId,
  owner: string,
  repo: string,
): Promise<void> {
  const [, , ownerKey, repoKey] = subjectKey(accountId, "", owner, repo, 0);
  return client.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === accountId &&
      SUGGESTION_AFFECTED.has(queryKey[1]) &&
      queryKey[2] === ownerKey &&
      queryKey[3] === repoKey,
  });
}
