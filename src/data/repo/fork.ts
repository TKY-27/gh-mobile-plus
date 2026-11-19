import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isGitHubError } from "../errors";
import { apiPath, graphql, rest } from "../internal/client";
import { HTTP_ACCEPTED } from "../internal/constants";
import { gitHubFailure } from "../internal/errors";
import { graphql as document } from "../internal/graphql";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { sleep } from "../internal/sleep";
import { useActiveAccount, type AccountId } from "../session";
import type { RepoRef } from "../types";

const FORK_READY_ATTEMPTS = 7;
const FORK_INITIAL_DELAY_MS = 1000;
const FORK_MAX_DELAY_MS = 8000;

const forkDocument = document(`
  query EditForkReady($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id name owner { login } defaultBranchRef { name }
    }
  }
`);

export interface ForkRepository {
  id: string;
  name: string;
  owner: { login: string };
  defaultBranchRef: { name: string } | null;
}

export async function waitForFork(
  accountId: AccountId,
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<ForkRepository> {
  for (let attempt = 0; attempt < FORK_READY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(FORK_INITIAL_DELAY_MS * 2 ** (attempt - 1), FORK_MAX_DELAY_MS), signal);
    }
    try {
      const result = await graphql(accountId, forkDocument, { owner, repo }, signal);
      if (result.repository?.defaultBranchRef) return result.repository;
    } catch (error) {
      if (!isGitHubError(error) || error.kind !== "notFound") throw error;
    }
  }
  throw gitHubFailure({ kind: "server", status: HTTP_ACCEPTED });
}

interface ForkOptions {
  organization?: string;
  name?: string;
  default_branch_only: boolean;
}

export async function requestFork(
  accountId: AccountId,
  owner: string,
  repo: string,
  options: ForkOptions,
): Promise<RepoRef> {
  const response = await rest<{ owner: { login: string }; name: string }>(accountId, {
    path: apiPath`/repos/${owner}/${repo}/forks`,
    method: "POST",
    body: options,
  });
  return { owner: response.body.owner.login, name: response.body.name };
}

export function useCreateFork(owner: string, repo: string) {
  const { id } = useActiveAccount();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (options: ForkOptions) => requestFork(id, owner, repo, options),
    onSuccess: (created) =>
      Promise.all([
        client.invalidateQueries({
          queryKey: accountKey(id, "users", "repositories", created.owner, "owned"),
        }),
        client.invalidateQueries({ queryKey: accountKey(id, "home", "viewer") }),
        client.invalidateQueries({ queryKey: accountKey(id, "repository", owner, repo) }),
      ]),
  });
}

export function useForkReadiness(fork: RepoRef) {
  const { id } = useActiveAccount();
  return useQuery({
    queryKey: accountKey(id, "forkReadiness", fork.owner, fork.name),
    queryFn: async ({ signal }) => {
      try {
        return await waitForFork(id, fork.owner, fork.name, signal);
      } catch (error) {
        if (isGitHubError(error) && error.kind === "server" && error.status === HTTP_ACCEPTED)
          return null;
        throw error;
      }
    },
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    retry: false,
  });
}
