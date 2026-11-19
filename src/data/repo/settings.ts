import { useMutation, useQueryClient, type QueryFilters } from "@tanstack/react-query";
import { apiPath, rest } from "../internal/client";
import { accountKey } from "../internal/query";
import { useActiveAccount } from "../session";

import type { Repository, MergeMethod } from "./index";

export interface RepositorySettings {
  description: string;
  homepage: string;
  has_issues: boolean;
  has_projects: boolean;
  has_wiki: boolean;
  allow_merge_commit: boolean;
  allow_squash_merge: boolean;
  allow_rebase_merge: boolean;
  allow_auto_merge: boolean;
  delete_branch_on_merge: boolean;
}

type SavedSettings = Pick<RepositorySettings, "has_issues" | "has_wiki" | "has_projects"> &
  Partial<Omit<RepositorySettings, "homepage" | "description">> & {
    description: string | null;
    homepage: string | null;
  };

export function mergeMethods(squash: boolean, merge: boolean, rebase: boolean): MergeMethod[] {
  const methods: MergeMethod[] = [];
  if (squash) methods.push("squash");
  if (merge) methods.push("merge");
  if (rebase) methods.push("rebase");
  return methods;
}

function withSavedSettings(
  repository: Repository | undefined,
  saved: SavedSettings,
  changes: Partial<RepositorySettings>,
) {
  if (!repository?.settings) return repository;
  const confirmed = { ...repository.settings, ...changes };
  const settings = {
    description: saved.description ?? "",
    homepage: saved.homepage ?? "",
    has_issues: saved.has_issues,
    has_wiki: saved.has_wiki,
    has_projects: saved.has_projects,
    allow_merge_commit: saved.allow_merge_commit ?? confirmed.allow_merge_commit,
    allow_squash_merge: saved.allow_squash_merge ?? confirmed.allow_squash_merge,
    allow_rebase_merge: saved.allow_rebase_merge ?? confirmed.allow_rebase_merge,
    allow_auto_merge: saved.allow_auto_merge ?? confirmed.allow_auto_merge,
    delete_branch_on_merge: saved.delete_branch_on_merge ?? confirmed.delete_branch_on_merge,
  };
  return {
    ...repository,
    settings,
    description: saved.description,
    hasIssues: settings.has_issues,
    allowedMergeMethods: mergeMethods(
      settings.allow_squash_merge,
      settings.allow_merge_commit,
      settings.allow_rebase_merge,
    ),
  };
}

export function useUpdateRepositorySettings(owner: string, repo: string) {
  const { id } = useActiveAccount();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (changes: Partial<RepositorySettings>) => {
      const response = await rest<SavedSettings>(id, {
        path: apiPath`/repos/${owner}/${repo}`,
        method: "PATCH",
        body: changes,
      });
      return response.body;
    },
    onSuccess: async (saved, changes) => {
      const sameRepository = (cachedOwner: unknown, cachedRepo: unknown) =>
        typeof cachedOwner === "string" &&
        cachedOwner.toLowerCase() === owner.toLowerCase() &&
        typeof cachedRepo === "string" &&
        cachedRepo.toLowerCase() === repo.toLowerCase();
      const repositoryQueries: QueryFilters = {
        queryKey: accountKey(id, "repository"),
        predicate: ({ queryKey }) => sameRepository(queryKey[2], queryKey[3]),
      };
      await client.cancelQueries(repositoryQueries);
      client.setQueriesData<Repository>(repositoryQueries, (current) =>
        withSavedSettings(current, saved, changes),
      );

      await client.invalidateQueries({
        queryKey: accountKey(id),
        predicate: ({ queryKey: [, area, section, name] }) => {
          if (area === "repository" || area === "conversation") {
            return sameRepository(section, name);
          }
          if (changes.description === undefined) return false;
          return (
            (area === "home" && section === "viewer") ||
            (area === "users" && (section === "repositories" || section === "profile")) ||
            (area === "search" && section === "repositories")
          );
        },
      });
    },
  });
}
