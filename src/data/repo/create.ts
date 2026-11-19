import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rest } from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { accountKey } from "../internal/query";
import { useActiveAccount } from "../session";
import type { RepoRef } from "../types";

interface NewRepository {
  name: string;
  description: string;
  private: boolean;
  auto_init: boolean;
}

export function useCreateRepository() {
  const account = useActiveAccount();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (repository: NewRepository): Promise<RepoRef> => {
      if (account.publicOnly && repository.private) {
        throw gitHubFailure({
          kind: "forbidden",
          message: "Private repository access is required",
        });
      }
      const response = await rest<{ owner: { login: string }; name: string }>(account.id, {
        path: "/user/repos",
        method: "POST",
        body: repository,
      });
      return { owner: response.body.owner.login, name: response.body.name };
    },
    onSuccess: ({ owner }) =>
      Promise.all([
        client.invalidateQueries({
          queryKey: accountKey(account.id, "users", "repositories", owner, "owned"),
        }),
        client.invalidateQueries({
          queryKey: accountKey(account.id, "users", "profile", owner.toLowerCase()),
        }),
        client.invalidateQueries({ queryKey: accountKey(account.id, "home", "viewer") }),
      ]),
  });
}
