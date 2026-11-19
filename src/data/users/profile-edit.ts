import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ViewerSummary } from "../home";
import { profileWebUrl } from "../links";
import { rest } from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { accountKey } from "../internal/query";
import { useActiveAccount } from "../session";
import type { UserProfile } from "./index";

export const PROFILE_FIELDS = [
  "name",
  "bio",
  "company",
  "location",
  "blog",
  "twitter_username",
  "email",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileFields = Record<ProfileField, string> & { hireable: boolean };
type GitHubProfileFields = Record<ProfileField, string | null> & { hireable: boolean | null };

function profileFields(profile: GitHubProfileFields): ProfileFields {
  return {
    name: profile.name ?? "",
    bio: profile.bio ?? "",
    company: profile.company ?? "",
    location: profile.location ?? "",
    blog: profile.blog ?? "",
    twitter_username: profile.twitter_username ?? "",
    email: profile.email ?? "",
    hireable: profile.hireable === true,
  };
}

function websiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const address = profileWebUrl(trimmed);
  if (address) return address.href;
  throw gitHubFailure({ kind: "validation", message: "Invalid website URL", fields: ["blog"] });
}

export function useProfileEditor() {
  const account = useActiveAccount();
  return useQuery({
    queryKey: accountKey(account.id, "users", "editor"),
    staleTime: 0,
    gcTime: 0,
    meta: { persist: "never" },
    queryFn: async ({ signal }) => {
      const { body, headers } = await rest<GitHubProfileFields>(account.id, {
        path: "/user",
        signal,
      });
      const scopes = (headers.get("X-OAuth-Scopes") ?? "").split(/[,\s]+/);
      return { fields: profileFields(body), canEdit: scopes.includes("user") };
    },
  });
}

export function useUpdateProfile() {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (changes: Partial<ProfileFields>) => {
      const { body } = await rest<GitHubProfileFields>(account.id, {
        path: "/user",
        method: "PATCH",
        body: {
          ...changes,
          ...(changes.blog !== undefined ? { blog: websiteUrl(changes.blog) } : {}),
          ...(changes.twitter_username === "" ? { twitter_username: null } : {}),
        },
      });
      return profileFields(body);
    },
    onSuccess: async (saved) => {
      const profileKey = accountKey(account.id, "users", "profile", account.login.toLowerCase());
      const viewerKey = accountKey(account.id, "home", "viewer");
      const editor = { queryKey: accountKey(account.id, "users", "editor"), exact: true };
      await Promise.all([
        queryClient.cancelQueries({ queryKey: profileKey }),
        queryClient.cancelQueries({ queryKey: viewerKey }),
        queryClient.cancelQueries(editor),
      ]);
      queryClient.setQueriesData(editor, { fields: saved, canEdit: true });
      queryClient.setQueryData<UserProfile>(profileKey, (profile) =>
        profile
          ? {
              ...profile,
              name: saved.name || null,
              bio: saved.bio || null,
              company: saved.company || null,
              location: saved.location || null,
              websiteUrl: saved.blog || null,
            }
          : undefined,
      );
      queryClient.setQueryData<ViewerSummary>(viewerKey, (viewer) =>
        viewer ? { ...viewer, name: saved.name || null } : undefined,
      );
    },
  });
}

interface SocialAccount {
  provider: string;
  url: string;
}

export function useSocialAccounts() {
  const account = useActiveAccount();
  return useQuery({
    queryKey: accountKey(account.id, "users", "social"),
    staleTime: 0,
    queryFn: async ({ signal }) =>
      (await rest<SocialAccount[]>(account.id, { path: "/user/social_accounts", signal })).body,
  });
}

export function useEditSocialAccounts() {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async ({ url, remove }: { url: string; remove: boolean }) => {
      await rest(account.id, {
        path: "/user/social_accounts",
        method: remove ? "DELETE" : "POST",
        body: { account_urls: [url] },
      });
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: accountKey(account.id, "users", "social") }),
        queryClient.invalidateQueries({
          queryKey: accountKey(account.id, "users", "profile", account.login.toLowerCase()),
        }),
      ]),
  });
}
