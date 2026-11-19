import { MAX_FILE_BYTES } from "../internal/constants";

const CONTROL_CHARS = /\p{Cc}/u;
export const MAX_FILE_PATH_LENGTH = 4096;

export type FilePathError =
  "empty" | "emptySegment" | "dotSegment" | "reservedGit" | "invalidCharacters" | "tooLong";

export type ValidatedFilePath =
  { ok: true; path: string; name: string } | { ok: false; error: FilePathError };

function validateSegments(segments: readonly string[]): FilePathError | null {
  for (const segment of segments) {
    if (segment === "" || segment.trim() === "") return "emptySegment";
    if (segment === "." || segment === "..") return "dotSegment";
    if (segment.toLowerCase() === ".git") return "reservedGit";
    if (segment.includes("\\") || CONTROL_CHARS.test(segment)) return "invalidCharacters";
  }
  return null;
}

export function normalizeDirectory(directory: string): string {
  return directory.replace(/^\/+|\/+$/g, "");
}

export function isValidDirectory(directory: string): boolean {
  if (directory.includes("\\") || CONTROL_CHARS.test(directory)) return false;
  const normalized = normalizeDirectory(directory);
  if (normalized === "") return true;
  return validateSegments(normalized.split("/")) === null;
}

export function validateNewFilePath(directory: string, input: string): ValidatedFilePath {
  if (
    input.includes("\\") ||
    CONTROL_CHARS.test(input) ||
    directory.includes("\\") ||
    CONTROL_CHARS.test(directory)
  ) {
    return { ok: false, error: "invalidCharacters" };
  }
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "empty" };
  const inputSegments = trimmed.split("/");
  const inputError = validateSegments(inputSegments);
  if (inputError !== null) return { ok: false, error: inputError };

  const cleanDirectory = normalizeDirectory(directory);
  const directorySegments = cleanDirectory === "" ? [] : cleanDirectory.split("/");
  const directoryError = validateSegments(directorySegments);
  if (directoryError !== null) return { ok: false, error: directoryError };

  const allSegments = [...directorySegments, ...inputSegments];
  const path = allSegments.join("/");
  if (path.length > MAX_FILE_PATH_LENGTH) return { ok: false, error: "tooLong" };
  const name = allSegments.at(-1);
  if (name === undefined) return { ok: false, error: "empty" };
  return { ok: true, path, name };
}

export function ancestorPaths(path: string): string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];
  for (let length = segments.length - 1; length >= 1; length--) {
    ancestors.push(segments.slice(0, length).join("/"));
  }
  return ancestors;
}

export function isContentWithinLimit(content: string): boolean {
  return new TextEncoder().encode(content).byteLength <= MAX_FILE_BYTES;
}

export function newFileDraftKey(
  owner: string,
  repo: string,
  branch: string,
  directory: string,
): string {
  return `new-file:${JSON.stringify([owner, repo, branch, normalizeDirectory(directory)])}`;
}
