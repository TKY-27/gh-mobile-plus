import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { graphql as document } from "../internal/graphql";
import { isGitHubError, type GitHubError } from "../errors";
import { apiPath, graphql, rest } from "../internal/client";
import { HTTP_ACCEPTED, HTTP_OK } from "../internal/constants";
import { gitHubFailure } from "../internal/errors";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { sleep } from "../internal/sleep";
import { useActiveAccount, type AccountId } from "../session";

export { diffLines } from "./lines";

export type CommitTarget =
  | { kind: "direct" }
  | { kind: "newBranch"; branchName: string; pullRequest: { title: string; body: string } }
  | { kind: "fork"; branchName: string; pullRequest: { title: string; body: string } };

export interface FileEdit {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  expectedHeadOid: string;
  message: { headline: string; body: string };
}

export type CommitOutcome =
  | { kind: "commit"; owner: string; repo: string; oid: string }
  | { kind: "pullRequest"; owner: string; repo: string; number: number };

export type CommitStep =
  "forking" | "waitingForFork" | "creatingBranch" | "committing" | "openingPullRequest";

const FORK_READY_ATTEMPTS = 7;
const FORK_INITIAL_DELAY_MS = 1000;
const FORK_MAX_DELAY_MS = 8000;
const MAX_BRANCH_NAME_ATTEMPTS = 3;
const REF_ALREADY_EXISTS = /\b(?:reference|ref)\b.*already exists/i;
const HEAD_CONFLICT =
  /expectedHeadOid|expected head|expected branch to point to|head.*(?:changed|moved|match)|stale.*head/i;
const BRANCH_PROTECTION = /protected branch|branch protection|repository rule|ruleset|GH006|GH013/i;
const MISSING_COMMIT =
  /(?:could not resolve|could not find|not found|does not exist|invalid).*(?:commit|oid)|(?:commit|oid).*(?:not found|does not exist|invalid)/i;

const commitDocument = document(`
  mutation CommitFileEdit($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) { commit { oid } }
  }
`);

const branchDocument = document(`
  mutation CreateEditBranch($input: CreateRefInput!) {
    createRef(input: $input) { ref { id } }
  }
`);

const pullDocument = document(`
  mutation OpenEditPullRequest($input: CreatePullRequestInput!) {
    createPullRequest(input: $input) { pullRequest { number } }
  }
`);

const repositoryDocument = document(`
  query EditRepository($owner: String!, $repo: String!, $findFork: Boolean!) {
    repository(owner: $owner, name: $repo) {
      id
      forks(first: 1, affiliations: [OWNER]) @include(if: $findFork) {
        nodes { id name owner { login } defaultBranchRef { name } }
      }
    }
  }
`);

const forkDocument = document(`
  query EditForkReady($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id name owner { login } defaultBranchRef { name }
    }
  }
`);

const latestDocument = document(`
  query LatestEditFile($owner: String!, $repo: String!, $ref: String!, $path: String!) {
    repository(owner: $owner, name: $repo) {
      ref(qualifiedName: $ref) {
        target {
          ... on Commit {
            oid
            file(path: $path) { object { ... on Blob { text isBinary } } }
          }
        }
      }
    }
  }
`);

interface EditRepository {
  id: string;
  name: string;
  owner: { login: string };
  defaultBranchRef: { name: string } | null;
}

function editFailure(error: unknown): never {
  if (isGitHubError(error) && (error.kind === "validation" || error.kind === "forbidden")) {
    if (BRANCH_PROTECTION.test(error.message)) {
      throw gitHubFailure({ kind: "forbidden", message: error.message });
    }
    if (HEAD_CONFLICT.test(error.message)) {
      throw gitHubFailure({ kind: "conflict", message: error.message });
    }
  }
  throw error;
}

async function commitFile(
  accountId: AccountId,
  edit: FileEdit,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(edit.content);
  const contents = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  try {
    const result = await graphql(accountId, commitDocument, {
      input: {
        branch: { repositoryNameWithOwner: `${owner}/${repo}`, branchName: branch },
        expectedHeadOid: edit.expectedHeadOid,
        fileChanges: { additions: [{ path: edit.path, contents }] },
        message: edit.message,
      },
    });
    const oid = result.createCommitOnBranch?.commit?.oid;
    if (!oid) throw gitHubFailure({ kind: "server", status: HTTP_OK });
    return oid;
  } catch (error) {
    editFailure(error);
  }
}

async function waitForFork(
  accountId: AccountId,
  owner: string,
  repo: string,
): Promise<EditRepository> {
  for (let attempt = 0; attempt < FORK_READY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(Math.min(FORK_INITIAL_DELAY_MS * 2 ** (attempt - 1), FORK_MAX_DELAY_MS));
    }
    try {
      const result = await graphql(accountId, forkDocument, { owner, repo });
      if (result.repository?.defaultBranchRef) return result.repository;
    } catch (error) {
      if (!isGitHubError(error) || error.kind !== "notFound") throw error;
    }
  }
  throw gitHubFailure({ kind: "server", status: HTTP_ACCEPTED });
}

async function editFork(
  accountId: AccountId,
  edit: FileEdit,
  existing: EditRepository | null,
  onStep?: (step: CommitStep) => void,
): Promise<EditRepository> {
  if (existing?.defaultBranchRef) return existing;
  let owner = existing?.owner.login;
  let repo = existing?.name;
  if (!existing) {
    onStep?.("forking");
    const response = await rest<{ owner: { login: string }; name: string }>(accountId, {
      path: apiPath`/repos/${edit.owner}/${edit.repo}/forks`,
      method: "POST",
      body: { default_branch_only: false },
    });
    owner = response.body.owner.login;
    repo = response.body.name;
  }
  onStep?.("waitingForFork");
  if (!owner || !repo) throw gitHubFailure({ kind: "server", status: HTTP_ACCEPTED });
  return waitForFork(accountId, owner, repo);
}

async function createBranch(
  accountId: AccountId,
  repositoryId: string,
  branch: string,
  oid: string,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? branch : `${branch}-${String(attempt)}`;
    try {
      const result = await graphql(accountId, branchDocument, {
        input: { repositoryId, name: `refs/heads/${candidate}`, oid },
      });
      if (!result.createRef?.ref) throw gitHubFailure({ kind: "server", status: HTTP_OK });
      return candidate;
    } catch (error) {
      if (
        attempt >= MAX_BRANCH_NAME_ATTEMPTS ||
        !isGitHubError(error) ||
        (error.kind !== "validation" && error.kind !== "conflict") ||
        !REF_ALREADY_EXISTS.test(error.message)
      )
        editFailure(error);
    }
  }
}

async function createForkBranch(
  accountId: AccountId,
  fork: EditRepository,
  edit: FileEdit,
  branch: string,
): Promise<string> {
  try {
    return await createBranch(accountId, fork.id, branch, edit.expectedHeadOid);
  } catch (error) {
    if (
      !isGitHubError(error) ||
      !(
        error.kind === "notFound" ||
        (error.kind === "validation" && MISSING_COMMIT.test(error.message))
      )
    ) {
      throw error;
    }
    await rest(accountId, {
      path: apiPath`/repos/${fork.owner.login}/${fork.name}/merge-upstream`,
      method: "POST",
      body: { branch: edit.branch },
    });
    return createBranch(accountId, fork.id, branch, edit.expectedHeadOid);
  }
}

async function commitEdit(
  accountId: AccountId,
  edit: FileEdit & { target: CommitTarget },
  onStep?: (step: CommitStep) => void,
): Promise<CommitOutcome> {
  const { target } = edit;
  if (target.kind === "direct") {
    onStep?.("committing");
    const oid = await commitFile(accountId, edit, edit.owner, edit.repo, edit.branch);
    return { kind: "commit", owner: edit.owner, repo: edit.repo, oid };
  }
  const result = await graphql(accountId, repositoryDocument, {
    owner: edit.owner,
    repo: edit.repo,
    findFork: target.kind === "fork",
  });
  const upstream = result.repository;
  if (!upstream) throw gitHubFailure({ kind: "notFound" });
  const fork =
    target.kind === "fork"
      ? await editFork(accountId, edit, upstream.forks?.nodes?.[0] ?? null, onStep)
      : null;
  const owner = fork?.owner.login ?? edit.owner;
  const repo = fork?.name ?? edit.repo;
  onStep?.("creatingBranch");
  const branch = fork
    ? await createForkBranch(accountId, fork, edit, target.branchName)
    : await createBranch(accountId, upstream.id, target.branchName, edit.expectedHeadOid);
  onStep?.("committing");
  await commitFile(accountId, edit, owner, repo, branch);
  onStep?.("openingPullRequest");
  const opened = await graphql(accountId, pullDocument, {
    input: {
      repositoryId: upstream.id,
      baseRefName: edit.branch,
      // GitHub requires qualified fork heads.
      headRefName: fork ? `${owner}:${branch}` : branch,
      ...(fork ? { headRepositoryId: fork.id } : {}),
      ...target.pullRequest,
    },
  });
  const number = opened.createPullRequest?.pullRequest?.number;
  if (!number) throw gitHubFailure({ kind: "server", status: HTTP_OK });
  return { kind: "pullRequest", owner: edit.owner, repo: edit.repo, number };
}

export function useCommitFileEdit(
  onStep?: (step: CommitStep) => void,
): UseMutationResult<CommitOutcome, GitHubError, FileEdit & { target: CommitTarget }> {
  const accountId = useActiveAccount().id;
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (edit) => commitEdit(accountId, edit, onStep),
    onSuccess: async (outcome, edit) => {
      const keys = [
        ...["file", "tree", "readme"].map((kind) =>
          accountKey(accountId, kind, edit.owner, edit.repo),
        ),
        accountKey(accountId, "commit", "latest", edit.owner, edit.repo),
        ...(edit.target.kind === "newBranch"
          ? [accountKey(accountId, "refs", edit.owner, edit.repo)]
          : []),
        ...(outcome.kind === "pullRequest" ? [accountKey(accountId, "work")] : []),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

export function useLatestFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  enabled: boolean,
): UseQueryResult<{ text: string; headOid: string }> {
  const accountId = useActiveAccount().id;
  return useQuery({
    queryKey: accountKey(accountId, "commit", "latest", owner, repo, branch, path),
    enabled,
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const result = await graphql(
        accountId,
        latestDocument,
        {
          owner,
          repo,
          ref: `refs/heads/${branch}`,
          path,
        },
        signal,
      );
      const head = result.repository?.ref?.target;
      if (!head || !("oid" in head)) throw gitHubFailure({ kind: "notFound" });
      const blob = head.file?.object;
      if (!blob || !("text" in blob)) throw gitHubFailure({ kind: "notFound" });
      if (blob.isBinary || blob.text === null) {
        throw gitHubFailure({ kind: "validation", message: "File is not text", fields: ["path"] });
      }
      return { text: blob.text, headOid: head.oid };
    },
  });
}

export function defaultBranchName(login: string, path: string, now: Date): string {
  const sanitize = (value: string): string =>
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const filename = path.split("/").at(-1) ?? "";
  const extension = filename.lastIndexOf(".");
  const stem = extension > 0 ? filename.slice(0, extension) : filename;
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  return `ghm/${sanitize(login) || "user"}/${date}-${sanitize(stem) || "file"}`;
}
