import type { GitHubError } from "../errors";
import type { AccountId } from "../session";

export interface PersistenceMeta extends Record<string, unknown> {
  private?: boolean;
  persist?: "profile" | "user-search" | "never";
}

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: GitHubError;
    queryMeta: PersistenceMeta;
  }
}

export const STALE_TIME = {
  list: 30_000,
  detail: 60_000,
  calendar: 3_600_000,
  readme: 600_000,
} as const;

export const PRIVATE_QUERY: PersistenceMeta = { private: true };

export function accountKey<const Parts extends readonly unknown[]>(
  accountId: AccountId,
  ...parts: Parts
): readonly [AccountId, ...Parts] {
  return [accountId, ...parts];
}
