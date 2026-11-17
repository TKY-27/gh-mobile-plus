import { readFragment, type FragmentOf } from "gql.tada";
import type { RepoSummary } from "../types";
import { graphql } from "./graphql";

export const repositorySummaryFragment = graphql(`
  fragment RepositorySummaryFields on Repository {
    owner {
      login
    }
    name
    description
    isPrivate
    isFork
    stargazerCount
    primaryLanguage {
      name
      color
    }
    updatedAt
  }
`);

export function mapRepositorySummary(
  repository: FragmentOf<typeof repositorySummaryFragment>,
): RepoSummary {
  const fields = readFragment(repositorySummaryFragment, repository);
  return {
    owner: fields.owner.login,
    name: fields.name,
    description: fields.description,
    isPrivate: fields.isPrivate,
    isFork: fields.isFork,
    stars: fields.stargazerCount,
    language: fields.primaryLanguage,
    updatedAt: fields.updatedAt,
  };
}
