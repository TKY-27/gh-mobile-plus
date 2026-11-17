import { parsePatch, type DiffHunk } from "./patch";

export interface ChangedFile {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** GitHub omits oversized patches. */
  hunks: readonly DiffHunk[] | null;
  viewed: "viewed" | "unviewed" | "dismissed";
  blobUrl: string;
}

export const MAX_REVIEW_FILES = 300;

export interface RestDiffFile {
  filename: string;
  previous_filename?: string;
  status: ChangedFile["status"];
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blob_url: string;
}

export function changedFileFrom(file: RestDiffFile, viewed: ChangedFile["viewed"]): ChangedFile {
  // Pure renames and binaries lack patches.
  const hunks = file.patch !== undefined ? parsePatch(file.patch) : file.changes === 0 ? [] : null;
  return {
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    hunks,
    viewed,
    blobUrl: file.blob_url,
  };
}
