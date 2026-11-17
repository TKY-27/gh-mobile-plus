import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiPath, rest } from "../internal/client";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import {
  changedFileFrom,
  MAX_REVIEW_FILES,
  type ChangedFile,
  type RestDiffFile,
} from "../review/files";
import { useActiveAccount } from "../session";
import type { Actor, ChecksState, RepoRef } from "../types";

export interface CommitDetail {
  oid: string;
  repo: RepoRef;
  messageHeadline: string;
  messageBody: string;
  author: Actor | null;
  authorName: string;
  committedAt: string;
  parents: readonly string[];
  additions: number;
  deletions: number;
  files: readonly ChangedFile[];
  checks: ChecksState;
  webUrl: string;
}

interface RestCommit {
  sha: string;
  html_url: string;
  author: { login: string; avatar_url: string } | null;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
    committer: { name: string; date: string } | null;
  };
  parents: readonly { sha: string }[];
  stats?: { additions: number; deletions: number };
  files?: RestDiffFile[];
}

const MESSAGE_SEPARATOR = /\r?\n/;
const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/;

function commitDetailFrom(owner: string, repo: string, commit: RestCommit): CommitDetail {
  const [headline = "", ...body] = commit.commit.message.split(MESSAGE_SEPARATOR);
  return {
    oid: commit.sha,
    repo: { owner, name: repo },
    messageHeadline: headline,
    messageBody: body.join("\n").replace(LEADING_BLANK_LINES, "").trimEnd(),
    author: commit.author && { login: commit.author.login, avatarUrl: commit.author.avatar_url },
    authorName: commit.commit.author?.name ?? commit.commit.committer?.name ?? "",
    committedAt: commit.commit.committer?.date ?? commit.commit.author?.date ?? "",
    parents: commit.parents.map((parent) => parent.sha),
    additions: commit.stats?.additions ?? 0,
    deletions: commit.stats?.deletions ?? 0,
    // Commits have no viewed state.
    files: (commit.files ?? [])
      .slice(0, MAX_REVIEW_FILES)
      .map((file) => changedFileFrom(file, "unviewed")),
    // The endpoint has no checks.
    checks: null,
    webUrl: commit.html_url,
  };
}

export function useCommit(owner: string, repo: string, sha: string): UseQueryResult<CommitDetail> {
  const accountId = useActiveAccount().id;
  return useQuery({
    queryKey: accountKey(accountId, "commit", owner, repo, sha),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const response = await rest<RestCommit>(accountId, {
        path: apiPath`/repos/${owner}/${repo}/commits/${sha}`,
        revalidate: true,
        signal,
      });
      return commitDetailFrom(owner, repo, response.body);
    },
  });
}
