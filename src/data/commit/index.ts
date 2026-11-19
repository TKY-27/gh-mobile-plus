import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useRef, type RefObject } from "react";
import {
  findSubmittedPull,
  proposalKey,
  reconcileProposalHead,
  type ProposalAttempt,
} from "./proposal";
import { graphql as document } from "../internal/graphql";
import { isGitHubError, type GitHubError } from "../errors";
import { graphql } from "../internal/client";
import { HTTP_ACCEPTED, HTTP_OK } from "../internal/constants";
import { gitHubFailure } from "../internal/errors";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { qualifiedRef, refKind, refName } from "../links";
import { openPullRequest } from "../pulls/create";
import { requestFork, waitForFork, type ForkRepository } from "../repo/fork";
import { useActiveAccount, type Account, type AccountId } from "../session";
import {
  ancestorPaths,
  isContentWithinLimit,
  isValidDirectory,
  normalizeDirectory,
  validateNewFilePath,
} from "./path";

export { diffLines } from "./lines";
export { MAX_FILE_BYTES } from "../internal/constants";
export {
  ancestorPaths,
  isContentWithinLimit,
  MAX_FILE_PATH_LENGTH,
  newFileDraftKey,
  normalizeDirectory,
  validateNewFilePath,
  type FilePathError,
  type ValidatedFilePath,
} from "./path";

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

export type CreateFileStep = "checkingPath" | CommitStep;

export interface FileCreation {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: { headline: string; body: string };
}

export type CreateFileIneligibleReason =
  "notBranch" | "archived" | "readOnly" | "emptyRepository" | "noPermission" | "notDirectory";

export type CreateFileContext =
  | {
      eligible: true;
      branch: string;
      directory: string;
      headOid: string;
      canPush: boolean;
      canProposePull: boolean;
    }
  | {
      eligible: false;
      reason: CreateFileIneligibleReason;
    };

export type CreateFileFailure =
  | { reason: "pathExists"; path: string }
  | { reason: "ancestorConflict"; path: string }
  | { reason: "readOnly" }
  | { reason: "noPermission" };

const BRANCH_REF_PREFIX = qualifiedRef("branches", "");
const CREATE_FILE_FAILURE = Symbol.for("ghm.createFileFailure");

function failCreateFile(error: GitHubError, failure: CreateFileFailure): never {
  const thrown = gitHubFailure(error);
  Object.defineProperty(thrown, CREATE_FILE_FAILURE, { value: failure });
  throw thrown;
}

function isCreateFileFailure(value: unknown): value is CreateFileFailure {
  if (typeof value !== "object" || value === null || !("reason" in value)) return false;
  switch (value.reason) {
    case "readOnly":
    case "noPermission":
      return true;
    case "pathExists":
    case "ancestorConflict":
      return "path" in value && typeof value.path === "string";
    default:
      return false;
  }
}

export function createFileFailure(error: unknown): CreateFileFailure | null {
  if (typeof error !== "object" || error === null) return null;
  const failure: unknown = Reflect.get(error, CREATE_FILE_FAILURE);
  return isCreateFileFailure(failure) ? failure : null;
}

function hasPushPermission(permission: string | null | undefined): boolean {
  return permission === "ADMIN" || permission === "MAINTAIN" || permission === "WRITE";
}

const MAX_BRANCH_NAME_ATTEMPTS = 3;
const REF_ALREADY_EXISTS = /\b(?:reference|ref)\b.*already exists/i;
const HEAD_CONFLICT =
  /expectedHeadOid|expected head|expected branch to point to|head.*(?:changed|moved|match)|stale.*head/i;
const BRANCH_PROTECTION = /protected branch|branch protection|repository rule|ruleset|GH006|GH013/i;
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

const repositoryDocument = document(`
  query EditRepository($owner: String!, $repo: String!, $findFork: Boolean!) {
    repository(owner: $owner, name: $repo) {
      id
      hasPullRequestsEnabled
      forks(first: 1, affiliations: [OWNER]) @include(if: $findFork) {
        nodes { id name owner { login } defaultBranchRef { name } }
      }
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

const createContextDocument = document(`
  query CreateFileContext(
    $owner: String!
    $repo: String!
    $branchRef: String!
    $directoryExpression: String!
    $hasDirectory: Boolean!
  ) {
    repository(owner: $owner, name: $repo) {
      isPrivate
      isArchived
      isDisabled
      isLocked
      isEmpty
      forkingAllowed
      hasPullRequestsEnabled
      viewerPermission
      ref(qualifiedName: $branchRef) {
        prefix
        target {
          __typename
          ... on Commit {
            oid
          }
        }
      }
      directory: object(expression: $directoryExpression) @include(if: $hasDirectory) {
        __typename
      }
    }
  }
`);

const checkNewFilePathDocument = document(`
  query CheckNewFilePath(
    $owner: String!
    $repo: String!
    $ref: String!
    $path: String!
    $parentPath: String!
    $hasParent: Boolean!
  ) {
    repository(owner: $owner, name: $repo) {
      isPrivate
      isArchived
      isDisabled
      isLocked
      forkingAllowed
      hasPullRequestsEnabled
      viewerPermission
      ref(qualifiedName: $ref) {
        prefix
        target {
          __typename
          ... on Commit {
            oid
            file(path: $path) {
              type
            }
            parent: file(path: $parentPath) @include(if: $hasParent) {
              type
            }
          }
        }
      }
    }
  }
`);

const checkCommitEntryDocument = document(`
  query CheckCommitEntry($owner: String!, $repo: String!, $oid: GitObjectID!, $path: String!) {
    repository(owner: $owner, name: $repo) {
      object(oid: $oid) {
        __typename
        ... on Commit {
          file(path: $path) {
            type
          }
        }
      }
    }
  }
`);

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

async function editFork(
  accountId: AccountId,
  edit: FileEdit,
  existing: ForkRepository | null,
  onStep?: (step: CommitStep) => void,
): Promise<ForkRepository> {
  if (existing?.defaultBranchRef) return existing;
  let owner = existing?.owner.login;
  let repo = existing?.name;
  if (!existing) {
    onStep?.("forking");
    const created = await requestFork(accountId, edit.owner, edit.repo, {
      default_branch_only: false,
    });
    owner = created.owner;
    repo = created.name;
  }
  onStep?.("waitingForFork");
  if (!owner || !repo) throw gitHubFailure({ kind: "server", status: HTTP_ACCEPTED });
  return waitForFork(accountId, owner, repo);
}

async function createBranch(
  accountId: AccountId,
  proposal: ProposalAttempt,
  branch: string,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? branch : `${branch}-${String(attempt)}`;
    proposal.branch = candidate;
    try {
      const result = await graphql(accountId, branchDocument, {
        input: {
          repositoryId: proposal.repositoryId,
          name: `refs/heads/${candidate}`,
          oid: proposal.edit.expectedHeadOid,
        },
      });
      if (!result.createRef?.ref) throw gitHubFailure({ kind: "server", status: HTTP_OK });
      proposal.confirmed = true;
      return;
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

async function commitEdit(
  accountId: AccountId,
  edit: FileEdit & { target: CommitTarget },
  pending: RefObject<ProposalAttempt | null>,
  key: string,
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
  if (!upstream.hasPullRequestsEnabled) {
    throw gitHubFailure({ kind: "forbidden", message: "Pull requests are disabled" });
  }
  const previous = pending.current?.key === key ? pending.current : null;
  let attempt = previous;
  if (!attempt) {
    const fork =
      target.kind === "fork"
        ? await editFork(accountId, edit, upstream.forks?.nodes?.[0] ?? null, onStep)
        : null;
    attempt = {
      key,
      edit,
      destination: { owner: fork?.owner.login ?? edit.owner, repo: fork?.name ?? edit.repo },
      repositoryId: fork?.id ?? upstream.id,
      branch: target.branchName,
      confirmed: false,
      commitOid: null,
    };
    pending.current = attempt;
  }
  if (previous?.commitOid) {
    const submitted = await findSubmittedPull(accountId, previous);
    if (submitted)
      return { kind: "pullRequest", owner: edit.owner, repo: edit.repo, number: submitted };
  }
  const reuse = previous ? await reconcileProposalHead(accountId, previous) : false;
  if (!reuse) {
    onStep?.("creatingBranch");
    try {
      await createBranch(accountId, attempt, attempt.branch);
    } catch (error) {
      if (isGitHubError(error) && error.kind !== "server" && error.kind !== "network") {
        pending.current = null;
      }
      throw error;
    }
  }
  const { owner, repo } = attempt.destination;
  if (!attempt.commitOid) {
    onStep?.("committing");
    attempt.edit = { ...attempt.edit, message: edit.message };
    attempt.commitOid = await commitFile(accountId, attempt.edit, owner, repo, attempt.branch);
  }
  onStep?.("openingPullRequest");
  const number = await openPullRequest(accountId, {
    repositoryId: upstream.id,
    baseRefName: edit.branch,
    headRefName: target.kind === "fork" ? `${owner}:${attempt.branch}` : attempt.branch,
    ...(target.kind === "fork" ? { headRepositoryId: attempt.repositoryId } : {}),
    ...target.pullRequest,
  });
  return { kind: "pullRequest", owner: edit.owner, repo: edit.repo, number };
}

async function invalidateAfterCommit(
  queryClient: QueryClient,
  accountId: AccountId,
  commit: { owner: string; repo: string; target: CommitTarget },
  outcome: CommitOutcome,
  proposal: ProposalAttempt | null,
): Promise<void> {
  const destination = outcome.kind === "pullRequest" && proposal ? proposal.destination : commit;
  const keys: (readonly unknown[])[] = [
    ...["file", "tree", "readme", "pullBranchComparison"].map((kind) =>
      accountKey(accountId, kind, destination.owner, destination.repo),
    ),
    accountKey(accountId, "commit", "latest", destination.owner, destination.repo),
    accountKey(accountId, "commit", "createContext", destination.owner, destination.repo),
  ];
  if (outcome.kind === "pullRequest") {
    keys.push(
      accountKey(accountId, "refs", destination.owner, destination.repo),
      accountKey(
        accountId,
        "issueList",
        commit.owner.toLowerCase(),
        commit.repo.toLowerCase(),
        "pulls",
      ),
      accountKey(accountId, "work"),
    );
  }
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useCommitFileEdit(
  onStep?: (step: CommitStep) => void,
): UseMutationResult<CommitOutcome, GitHubError, FileEdit & { target: CommitTarget }> {
  const accountId = useActiveAccount().id;
  const queryClient = useQueryClient();
  const pending = useRef<ProposalAttempt | null>(null);
  return useMutation({
    retry: false,
    mutationFn: (edit) =>
      commitEdit(accountId, edit, pending, proposalKey(accountId, edit, edit.target), onStep),
    onSuccess: (outcome, edit) => {
      const proposal = pending.current;
      pending.current = null;
      return invalidateAfterCommit(queryClient, accountId, edit, outcome, proposal);
    },
  });
}

async function verifyHigherAncestors(
  accountId: AccountId,
  owner: string,
  repo: string,
  oid: string,
  ancestors: readonly string[],
): Promise<void> {
  for (const ancestor of ancestors) {
    const result = await graphql(accountId, checkCommitEntryDocument, {
      owner,
      repo,
      oid,
      path: ancestor,
    });
    const commitObject = result.repository?.object;
    if (commitObject?.__typename !== "Commit") {
      throw gitHubFailure({ kind: "conflict", message: "Expected commit is unavailable" });
    }
    if (commitObject.file === null) continue;
    if (commitObject.file.type === "tree") return;
    failCreateFile(
      { kind: "conflict", message: "Ancestor path is not a folder" },
      { reason: "ancestorConflict", path: ancestor },
    );
  }
}

async function verifyNewFileTarget(
  account: Account,
  creation: FileCreation,
  targetKind: CommitTarget["kind"],
): Promise<{ path: string; headOid: string }> {
  const validated = validateNewFilePath("", creation.path);
  if (!validated.ok) {
    throw gitHubFailure({ kind: "validation", message: "File path is invalid", fields: ["path"] });
  }
  if (!isContentWithinLimit(creation.content)) {
    throw gitHubFailure({
      kind: "validation",
      message: "File exceeds 1 MB limit",
      fields: ["content"],
    });
  }
  const ancestors = ancestorPaths(validated.path);
  const firstAncestor = ancestors[0];
  const result = await graphql(account.id, checkNewFilePathDocument, {
    owner: creation.owner,
    repo: creation.repo,
    ref: qualifiedRef("branches", creation.branch),
    path: validated.path,
    parentPath: firstAncestor ?? "",
    hasParent: firstAncestor !== undefined,
  });
  const repository = result.repository;
  if (!repository) throw gitHubFailure({ kind: "notFound" });
  if (repository.isArchived || repository.isDisabled || repository.isLocked) {
    failCreateFile(
      { kind: "forbidden", message: "Repository is read-only" },
      { reason: "readOnly" },
    );
  }
  const blockedByPublicOnly = account.publicOnly && repository.isPrivate;
  const canPush = !blockedByPublicOnly && hasPushPermission(repository.viewerPermission);
  if (targetKind !== "direct" && !repository.hasPullRequestsEnabled) {
    failCreateFile(
      { kind: "forbidden", message: "Pull requests are disabled" },
      { reason: "noPermission" },
    );
  }
  if (targetKind !== "fork" && !canPush) {
    failCreateFile(
      { kind: "forbidden", message: "Push access required" },
      { reason: "noPermission" },
    );
  }
  if (targetKind === "fork" && (!repository.forkingAllowed || blockedByPublicOnly)) {
    failCreateFile(
      { kind: "forbidden", message: "Forking is unavailable" },
      { reason: "noPermission" },
    );
  }
  const branchRef = repository.ref;
  const commitTarget = branchRef?.target;
  if (branchRef?.prefix !== BRANCH_REF_PREFIX || commitTarget?.__typename !== "Commit") {
    throw gitHubFailure({
      kind: "validation",
      message: "Target ref is not a branch",
      fields: ["branch"],
    });
  }
  if (commitTarget.file !== null) {
    failCreateFile(
      { kind: "conflict", message: "Path already exists" },
      { reason: "pathExists", path: validated.path },
    );
  }
  if (firstAncestor !== undefined) {
    const parent = commitTarget.parent;
    if (parent !== null && parent !== undefined) {
      if (parent.type !== "tree") {
        failCreateFile(
          { kind: "conflict", message: "Ancestor path is not a folder" },
          { reason: "ancestorConflict", path: firstAncestor },
        );
      }
    } else if (ancestors.length > 1) {
      await verifyHigherAncestors(
        account.id,
        creation.owner,
        creation.repo,
        commitTarget.oid,
        ancestors.slice(1),
      );
    }
  }
  return { path: validated.path, headOid: commitTarget.oid };
}

async function commitNewFile(
  account: Account,
  creation: FileCreation & { target: CommitTarget },
  pending: RefObject<ProposalAttempt | null>,
  onStep?: (step: CreateFileStep) => void,
): Promise<CommitOutcome> {
  const key = proposalKey(account.id, creation, creation.target);
  if (pending.current?.key === key) {
    return commitEdit(
      account.id,
      { ...pending.current.edit, message: creation.message, target: creation.target },
      pending,
      key,
      onStep,
    );
  }
  onStep?.("checkingPath");
  const verified = await verifyNewFileTarget(account, creation, creation.target.kind);
  return commitEdit(
    account.id,
    { ...creation, path: verified.path, expectedHeadOid: verified.headOid },
    pending,
    key,
    onStep,
  );
}

export function useCreateFile(
  onStep?: (step: CreateFileStep) => void,
): UseMutationResult<CommitOutcome, GitHubError, FileCreation & { target: CommitTarget }> {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  const pending = useRef<ProposalAttempt | null>(null);
  return useMutation({
    retry: false,
    mutationFn: (creation) => commitNewFile(account, creation, pending, onStep),
    onSuccess: (outcome, creation) => {
      const proposal = pending.current;
      pending.current = null;
      return invalidateAfterCommit(queryClient, account.id, creation, outcome, proposal);
    },
  });
}

export function useCreateFileContext(
  owner: string,
  repo: string,
  urlRef: string,
  rawDirectory: string,
): UseQueryResult<CreateFileContext> {
  const account = useActiveAccount();
  const directory = normalizeDirectory(rawDirectory);
  return useQuery({
    queryKey: accountKey(account.id, "commit", "createContext", owner, repo, urlRef, directory),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }): Promise<CreateFileContext> => {
      if (refKind(urlRef) === "tags") return { eligible: false, reason: "notBranch" };
      if (!isValidDirectory(rawDirectory)) return { eligible: false, reason: "notDirectory" };
      const branch = refKind(urlRef) === "branches" ? refName(urlRef) : urlRef;
      const branchRef = qualifiedRef("branches", branch);
      const result = await graphql(
        account.id,
        createContextDocument,
        {
          owner,
          repo,
          branchRef,
          directoryExpression: `${branchRef}:${directory}`,
          hasDirectory: directory !== "",
        },
        signal,
      );
      const repository = result.repository;
      if (!repository) throw gitHubFailure({ kind: "notFound" });
      if (repository.isArchived) return { eligible: false, reason: "archived" };
      if (repository.isDisabled || repository.isLocked) {
        return { eligible: false, reason: "readOnly" };
      }
      if (repository.isEmpty) return { eligible: false, reason: "emptyRepository" };
      const blockedByPublicOnly = account.publicOnly && repository.isPrivate;
      const canPush = !blockedByPublicOnly && hasPushPermission(repository.viewerPermission);
      const canProposePull =
        !blockedByPublicOnly &&
        repository.hasPullRequestsEnabled &&
        (canPush || repository.forkingAllowed);
      if (!canPush && !canProposePull) return { eligible: false, reason: "noPermission" };
      const resolvedRef = repository.ref;
      const commitTarget = resolvedRef?.target;
      if (resolvedRef?.prefix !== BRANCH_REF_PREFIX || commitTarget?.__typename !== "Commit") {
        return { eligible: false, reason: "notBranch" };
      }
      if (directory !== "" && repository.directory?.__typename !== "Tree") {
        return { eligible: false, reason: "notDirectory" };
      }
      return {
        eligible: true,
        branch,
        directory,
        headOid: commitTarget.oid,
        canPush,
        canProposePull,
      };
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
