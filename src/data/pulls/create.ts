import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VariablesOf } from "gql.tada";
import { graphql } from "../internal/client";
import { HTTP_OK } from "../internal/constants";
import { gitHubFailure } from "../internal/errors";
import { graphql as document } from "../internal/graphql";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { qualifiedRef } from "../links";
import { useActiveAccount, type AccountId } from "../session";

const comparisonDocument = document(`
  query PullBranchComparison($owner: String!, $repo: String!, $base: String!, $head: String!) {
    repository(owner: $owner, name: $repo) {
      id
      ref(qualifiedName: $base) {
        compare(headRef: $head) {
          aheadBy
          behindBy
        }
      }
    }
    rateLimit { limit remaining resetAt }
  }
`);

const createPullDocument = document(`
  mutation OpenEditPullRequest($input: CreatePullRequestInput!) {
    createPullRequest(input: $input) { pullRequest { number } }
  }
`);

type PullProposal = VariablesOf<typeof createPullDocument>["input"];

export async function openPullRequest(accountId: AccountId, input: PullProposal) {
  const response = await graphql(accountId, createPullDocument, { input });
  const number = response.createPullRequest?.pullRequest?.number;
  if (!number) throw gitHubFailure({ kind: "server", status: HTTP_OK });
  return number;
}

export function useBranchComparison(owner: string, repo: string, base: string, head: string) {
  const { id } = useActiveAccount();
  return useQuery({
    queryKey: accountKey(id, "pullBranchComparison", owner, repo, base, head),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    enabled: Boolean(base && head && base !== head),
    queryFn: async ({ signal }) => {
      const { repository } = await graphql(
        id,
        comparisonDocument,
        { owner, repo, base: qualifiedRef("branches", base), head },
        signal,
      );
      const comparison = repository?.ref?.compare;
      if (!repository || !comparison) throw gitHubFailure({ kind: "notFound" });
      return { repositoryId: repository.id, ...comparison };
    },
  });
}

export function useCreatePullRequest(owner: string, repo: string) {
  const { id } = useActiveAccount();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (proposal: PullProposal) => openPullRequest(id, proposal),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({
          queryKey: accountKey(id, "issueList", owner.toLowerCase(), repo.toLowerCase(), "pulls"),
        }),
        client.invalidateQueries({ queryKey: accountKey(id, "work") }),
      ]),
  });
}
