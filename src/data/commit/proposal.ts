import { apiPath, graphql, rest } from "../internal/client";
import { gitHubFailure } from "../internal/errors";
import { graphql as document } from "../internal/graphql";
import { qualifiedRef } from "../links";
import type { AccountId } from "../session";
import type { CommitTarget, FileCreation, FileEdit } from "./index";

export interface ProposalAttempt {
  key: string;
  edit: FileEdit;
  destination: Pick<FileEdit, "owner" | "repo">;
  repositoryId: string;
  branch: string;
  confirmed: boolean;
  commitOid: string | null;
}

export function proposalKey(accountId: AccountId, edit: FileCreation, target: CommitTarget) {
  return JSON.stringify([
    accountId,
    edit.owner,
    edit.repo,
    edit.branch,
    edit.path,
    edit.content,
    "expectedHeadOid" in edit ? edit.expectedHeadOid : null,
    target.kind,
    target.kind === "direct" ? null : target.branchName,
  ]);
}

const proposalHeadDocument = document(`
  query EditProposalHead($owner: String!, $repo: String!, $ref: String!, $path: String!) {
    repository(owner: $owner, name: $repo) {
      ref(qualifiedName: $ref) {
        target {
          ... on Commit {
            oid messageHeadline messageBody changedFilesIfAvailable
            author { user { databaseId } }
            parents(first: 1) { totalCount nodes { oid } }
            file(path: $path) { object { ... on Blob { text } } }
          }
        }
      }
    }
  }
`);

export async function reconcileProposalHead(accountId: AccountId, attempt: ProposalAttempt) {
  const { edit, destination, branch } = attempt;
  const { repository } = await graphql(accountId, proposalHeadDocument, {
    ...destination,
    ref: qualifiedRef("branches", branch),
    path: edit.path,
  });
  if (!repository) throw gitHubFailure({ kind: "notFound" });
  if (!repository.ref && !attempt.confirmed) return false;
  const head = repository.ref?.target;
  if (attempt.confirmed && head && "oid" in head) {
    if (attempt.commitOid && head.oid === attempt.commitOid) return true;
    if (!attempt.commitOid) {
      if (head.oid === edit.expectedHeadOid) return true;
      const blob = head.file?.object;
      if (
        head.parents.totalCount === 1 &&
        head.parents.nodes?.[0]?.oid === edit.expectedHeadOid &&
        head.author?.user?.databaseId === accountId &&
        head.changedFilesIfAvailable === 1 &&
        head.messageHeadline === edit.message.headline &&
        head.messageBody === edit.message.body &&
        blob &&
        "text" in blob &&
        blob.text === edit.content
      ) {
        attempt.commitOid = head.oid;
        return true;
      }
    }
  }
  throw gitHubFailure({ kind: "conflict", message: "The proposal branch has changed" });
}

interface ExistingPull {
  number: number;
  user: { id: number } | null;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
}

export async function findSubmittedPull(accountId: AccountId, attempt: ProposalAttempt) {
  const { edit, branch, destination, commitOid } = attempt;
  const { body } = await rest<ExistingPull[]>(accountId, {
    path: apiPath`/repos/${edit.owner}/${edit.repo}/pulls`,
    query: { state: "all", base: edit.branch, head: `${destination.owner}:${branch}` },
  });
  const name = `${destination.owner}/${destination.repo}`.toLowerCase();
  return body.find(
    (pull) =>
      pull.user?.id === accountId &&
      pull.head.sha === commitOid &&
      pull.base.ref === edit.branch &&
      pull.head.ref === branch &&
      pull.head.repo?.full_name.toLowerCase() === name,
  )?.number;
}
