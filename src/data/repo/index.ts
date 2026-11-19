import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { readFragment, type ResultOf } from "gql.tada";
import { mergeMethods, type RepositorySettings } from "./settings";
import { isGitHubError, type GitHubError } from "../errors";
import { apiPath, GITHUB_HTML_JSON, graphql, rest } from "../internal/client";
import { MAX_FILE_BYTES } from "../internal/constants";
import { gitHubFailure } from "../internal/errors";
import { accountKey, PRIVATE_QUERY, STALE_TIME } from "../internal/query";
import { qualifiedRef, refKind, refPathCandidates } from "../links";
import { useActiveAccount, type AccountId } from "../session";
import { useIsOffline } from "../status";
import type { Page, Release, RepoRef } from "../types";
import {
  addStarMutation,
  fileQuery,
  refsQuery,
  releaseFragment,
  releaseQuery,
  releasesQuery,
  removeStarMutation,
  repositoryQuery,
  resolveRefQuery,
  treeQuery,
  watchMutation,
} from "./queries";

export { useCreateFork, useForkReadiness } from "./fork";
export type { RepositorySettings } from "./settings";
export { useUpdateRepositorySettings } from "./settings";

export type MergeMethod = "squash" | "merge" | "rebase";
export interface Repository {
  owner: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  parent: RepoRef | null;
  stars: number;
  forks: number;
  watchers: number;
  language: { name: string; color: string | null } | null;
  license: string | null;
  defaultBranch: string;
  viewerHasStarred: boolean;
  viewerSubscription: "subscribed" | "ignored" | "unsubscribed";
  viewerCanPush: boolean;
  viewerCanEditFiles: boolean;
  forkingAllowed: boolean;
  hasPullRequestsEnabled: boolean;
  viewerCanProposePull: boolean;
  settings: RepositorySettings | null;
  allowedMergeMethods: readonly MergeMethod[];
  hasIssues: boolean;
  webUrl: string;
}
export interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "submodule" | "symlink";
  size: number | null;
}
export type FileContent =
  | {
      kind: "text";
      text: string;
      size: number;
      lineCount: number;
      blobSha: string;
      headOid: string;
      onBranch: boolean;
      language: string | null;
    }
  | {
      kind: "markdown";
      text: string;
      html: string;
      size: number;
      lineCount: number;
      blobSha: string;
      headOid: string;
      onBranch: boolean;
    }
  | { kind: "image"; src: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number; rawUrl: string };
export interface ReleaseDetail extends Release {
  notesHtml: string;
  assets: readonly { name: string; size: number; downloadUrl: string; downloadCount: number }[];
  webUrl: string;
}

const MAX_FILE_LINES = 20_000;
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
};
const LANGUAGES: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  rs: "rust",
  go: "go",
  py: "python",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "zsh",
  fish: "fish",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
  php: "php",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  clj: "clojure",
  scala: "scala",
  diff: "diff",
  patch: "diff",
};
const SYMLINK_MODE = 0o120000;
const SUBMODULE_MODE = 0o160000;

type RepositoryNode = NonNullable<ResultOf<typeof repositoryQuery>["repository"]>;

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw gitHubFailure({ kind: "notFound" });
  return value;
}

function repositoryFrom(node: RepositoryNode): Repository {
  const viewerCanPush =
    node.viewerPermission === "ADMIN" ||
    node.viewerPermission === "MAINTAIN" ||
    node.viewerPermission === "WRITE";
  return {
    owner: node.owner.login,
    name: node.name,
    description: node.description,
    isPrivate: node.isPrivate,
    isFork: node.isFork,
    parent: node.parent ? { owner: node.parent.owner.login, name: node.parent.name } : null,
    stars: node.stargazerCount,
    forks: node.forkCount,
    watchers: node.watchers.totalCount,
    language: node.primaryLanguage,
    license: node.licenseInfo?.name ?? null,
    defaultBranch: node.defaultBranchRef?.name ?? "",
    viewerHasStarred: node.viewerHasStarred,
    viewerSubscription:
      node.viewerSubscription === "SUBSCRIBED"
        ? "subscribed"
        : node.viewerSubscription === "IGNORED"
          ? "ignored"
          : "unsubscribed",
    viewerCanPush,
    viewerCanEditFiles:
      !node.isArchived &&
      !node.isDisabled &&
      !node.isLocked &&
      (viewerCanPush || (node.hasPullRequestsEnabled && node.forkingAllowed)),
    forkingAllowed: node.forkingAllowed,
    hasPullRequestsEnabled: node.hasPullRequestsEnabled,
    viewerCanProposePull:
      node.hasPullRequestsEnabled &&
      !node.isArchived &&
      !node.isDisabled &&
      !node.isLocked &&
      (viewerCanPush || ("viewerIsAMember" in node.owner && node.owner.viewerIsAMember)),
    settings:
      node.viewerCanAdminister && !node.isArchived
        ? {
            description: node.description ?? "",
            homepage: node.homepageUrl ?? "",
            has_issues: node.hasIssuesEnabled,
            has_projects: node.hasProjectsEnabled,
            has_wiki: node.hasWikiEnabled,
            allow_merge_commit: node.mergeCommitAllowed,
            allow_squash_merge: node.squashMergeAllowed,
            allow_rebase_merge: node.rebaseMergeAllowed,
            allow_auto_merge: node.autoMergeAllowed,
            delete_branch_on_merge: node.deleteBranchOnMerge,
          }
        : null,
    allowedMergeMethods: mergeMethods(
      node.squashMergeAllowed,
      node.mergeCommitAllowed,
      node.rebaseMergeAllowed,
    ),
    hasIssues: node.hasIssuesEnabled,
    webUrl: node.url,
  };
}

export function useRepository(owner: string, repo: string): UseQueryResult<Repository> {
  const { id } = useActiveAccount();
  const client = useQueryClient();
  return useQuery<Repository>({
    queryKey: accountKey(id, "repository", owner, repo),
    staleTime: (query) =>
      query.state.data?.viewerCanEditFiles === undefined ? 0 : STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const node = required(
        (await graphql(id, repositoryQuery, { owner, repo }, signal)).repository,
      );
      client.setQueryData(accountKey(id, "repositoryId", owner, repo), node.id);
      return repositoryFrom(node);
    },
  });
}

type ToggleVariables<Key extends "star" | "subscribe"> = { owner: string; repo: string } & Record<
  Key,
  boolean
>;

function useRepositoryToggle<Key extends "star" | "subscribe">(
  key: Key,
): UseMutationResult<void, GitHubError, ToggleVariables<Key>> {
  const { id } = useActiveAccount();
  const client = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (variables: ToggleVariables<Key>) => {
      const { owner, repo } = variables;
      const enabled = variables[key];
      let nodeId = client.getQueryData<string>(accountKey(id, "repositoryId", owner, repo));
      if (!nodeId) {
        nodeId = required((await graphql(id, repositoryQuery, { owner, repo })).repository).id;
        client.setQueryData(accountKey(id, "repositoryId", owner, repo), nodeId);
      }
      if (key === "subscribe")
        await graphql(id, watchMutation, {
          id: nodeId,
          state: enabled ? "SUBSCRIBED" : "UNSUBSCRIBED",
        });
      else if (enabled) await graphql(id, addStarMutation, { id: nodeId });
      else await graphql(id, removeStarMutation, { id: nodeId });
    },
    onMutate: async (variables) => {
      const { owner, repo } = variables;
      const enabled = variables[key];
      const queryKey = accountKey(id, "repository", owner, repo);
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<Repository>(queryKey);
      client.setQueryData<Repository>(queryKey, (current) => {
        if (!current) return current;
        return key === "subscribe"
          ? {
              ...current,
              viewerSubscription: enabled ? "subscribed" : "unsubscribed",
              watchers:
                current.watchers +
                Number(enabled) -
                Number(current.viewerSubscription === "subscribed"),
            }
          : {
              ...current,
              viewerHasStarred: enabled,
              stars: current.stars + Number(enabled) - Number(current.viewerHasStarred),
            };
      });
      return { key: queryKey, previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) client.setQueryData(context.key, context.previous);
    },
    onSettled: (_result, _error, { owner, repo }) =>
      client.invalidateQueries({ queryKey: accountKey(id, "repository", owner, repo) }),
  });
}

export function useStar(): UseMutationResult<
  void,
  GitHubError,
  { owner: string; repo: string; star: boolean }
> {
  return useRepositoryToggle("star");
}

export function useWatch(): UseMutationResult<
  void,
  GitHubError,
  { owner: string; repo: string; subscribe: boolean }
> {
  return useRepositoryToggle("subscribe");
}

function contentsPath(owner: string, repo: string, path: string): string {
  return (
    apiPath`/repos/${owner}/${repo}/contents` +
    "/" +
    path.split("/").map(encodeURIComponent).join("/")
  );
}

export function useReadme(
  owner: string,
  repo: string,
  ref: string | null,
): UseQueryResult<{ html: string; path: string } | null> {
  const { id } = useActiveAccount();
  return useQuery({
    queryKey: accountKey(id, "readme", owner, repo, ref),
    staleTime: STALE_TIME.readme,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      try {
        const request = {
          path: apiPath`/repos/${owner}/${repo}/readme`,
          query: { ref },
          signal,
          revalidate: true,
        };
        const [metadata, rendered] = await Promise.all([
          rest<{ path: string }>(id, request),
          rest<string>(id, { ...request, accept: GITHUB_HTML_JSON }),
        ]);
        return { html: rendered.body, path: metadata.body.path };
      } catch (error) {
        if (isGitHubError(error) && error.kind === "notFound") return null;
        throw error;
      }
    },
  });
}

export interface RefNames {
  branches: readonly string[];
  tags: readonly string[];
  truncated: boolean;
}

const REF_PAGE_SIZE = 100;
const BRANCH_REF_PREFIX = qualifiedRef("branches", "");
const TAG_REF_PREFIX = qualifiedRef("tags", "");
export const MAX_REFS_PER_KIND = 500;
const MAX_REF_PAGES = MAX_REFS_PER_KIND / REF_PAGE_SIZE;

type RefConnection = NonNullable<NonNullable<ResultOf<typeof refsQuery>["repository"]>["branches"]>;

function collectRefs(connection: RefConnection | null | undefined, names: string[]) {
  names.push(...(connection?.nodes ?? []).flatMap((ref) => ref?.name ?? []));
  return connection?.pageInfo.hasNextPage ? required(connection.pageInfo.endCursor) : null;
}

async function fetchRefs(
  id: AccountId,
  owner: string,
  repo: string,
  query: string | null,
  signal: AbortSignal,
): Promise<RefNames> {
  const branches: string[] = [];
  const tags: string[] = [];
  let branchesAfter: string | null = null;
  let tagsAfter: string | null = null;
  let withBranches = true;
  let withTags = true;
  let defaultBranch: string | undefined;
  for (let page = 0; page < MAX_REF_PAGES && (withBranches || withTags); page++) {
    const variables = {
      owner,
      repo,
      query,
      pageSize: REF_PAGE_SIZE,
      branchesAfter,
      tagsAfter,
      withBranches,
      withTags,
    };
    const node = required((await graphql(id, refsQuery, variables, signal)).repository);
    defaultBranch ??= node.defaultBranchRef?.name;
    if (withBranches) branchesAfter = collectRefs(node.branches, branches);
    if (withTags) tagsAfter = collectRefs(node.tags, tags);
    withBranches = branchesAfter !== null;
    withTags = tagsAfter !== null;
  }
  const sorted =
    defaultBranch && (query === null || branches.includes(defaultBranch))
      ? [defaultBranch, ...branches.filter((branch) => branch !== defaultBranch)]
      : branches;
  return {
    branches: sorted.slice(0, MAX_REFS_PER_KIND),
    tags,
    truncated: withBranches || withTags,
  };
}

export function useRefs(
  owner: string,
  repo: string,
  filter = "",
  enabled = true,
): UseQueryResult<RefNames> {
  const { id } = useActiveAccount();
  return useQuery({
    queryKey: accountKey(id, "refs", owner, repo, filter),
    enabled,
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    queryFn: ({ signal }) => fetchRefs(id, owner, repo, filter || null, signal),
  });
}

export function useFilteredRefs(owner: string, repo: string, search: string) {
  const offline = useIsOffline();
  const refs = useRefs(owner, repo);
  const searchGitHub = !offline && refs.data?.truncated === true && search !== "";
  const matching = useRefs(owner, repo, search, searchGitHub);
  const results = searchGitHub ? matching : refs;
  const needle = search.toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  return {
    ...results,
    branches: (results.data?.branches ?? []).filter(matches),
    tags: (results.data?.tags ?? []).filter(matches),
  };
}

function codeQueryKey(
  id: AccountId,
  kind: "file" | "tree",
  owner: string,
  repo: string,
  ref: string,
  path: string,
) {
  return accountKey(id, kind, owner, repo, ref, path);
}

export function useResolvedRefPath(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  kind: "tree" | "blob",
  enabled: boolean,
) {
  const { id } = useActiveAccount();
  const client = useQueryClient();
  const offline = useIsOffline();
  const candidates = [...refPathCandidates(ref, path, kind), { ref, path }];
  const resolution = useQuery({
    queryKey: accountKey(id, "refPath", owner, repo, ref, path, kind),
    enabled,
    networkMode: "online",
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const refs = await fetchRefs(id, owner, repo, ref, signal);
      const branches = new Set(refs.branches);
      const tags = new Set(refs.tags);
      for (const candidate of candidates) {
        const branch = qualifiedRef("branches", candidate.ref);
        const tag = qualifiedRef("tags", candidate.ref);
        if (branches.has(candidate.ref)) return { ref: branch, path: candidate.path };
        if (refs.truncated) {
          const repository = required(
            (await graphql(id, resolveRefQuery, { owner, repo, branch, tag }, signal)).repository,
          );
          if (
            repository.branch?.prefix === BRANCH_REF_PREFIX &&
            repository.branch.name === candidate.ref
          ) {
            return { ref: branch, path: candidate.path };
          }
          if (repository.tag?.prefix === TAG_REF_PREFIX && repository.tag.name === candidate.ref) {
            return { ref: tag, path: candidate.path };
          }
        }
        if (tags.has(candidate.ref)) return { ref: tag, path: candidate.path };
      }
      return null;
    },
  });
  const resource = kind === "blob" ? "file" : "tree";
  let resolvedPath = resolution.data;
  if (enabled && offline && resolvedPath == null) {
    for (const candidate of candidates) {
      const cachedRef = [
        qualifiedRef("branches", candidate.ref),
        qualifiedRef("tags", candidate.ref),
      ].find(
        (ref) =>
          client.getQueryData(codeQueryKey(id, resource, owner, repo, ref, candidate.path)) !==
          undefined,
      );
      if (cachedRef) {
        resolvedPath = { ref: cachedRef, path: candidate.path };
        break;
      }
    }
  }
  return {
    resolvedPath: offline ? (resolvedPath ?? null) : resolvedPath,
    error: offline ? null : resolution.error,
    refetch: resolution.refetch,
  };
}

export function useTree(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  enabled = true,
): UseQueryResult<readonly TreeEntry[]> {
  const { id } = useActiveAccount();
  return useQuery({
    queryKey: codeQueryKey(id, "tree", owner, repo, ref, path),
    enabled,
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      const object = required(
        required(
          (await graphql(id, treeQuery, { owner, repo, expression: `${ref}:${path}` }, signal))
            .repository,
        ).object,
      );
      if (object.__typename !== "Tree") throw gitHubFailure({ kind: "notFound" });
      const entries: TreeEntry[] = (object.entries ?? []).map((entry) => ({
        name: entry.name,
        path: entry.path ?? (path ? `${path}/${entry.name}` : entry.name),
        type:
          entry.mode === SYMLINK_MODE
            ? "symlink"
            : entry.mode === SUBMODULE_MODE
              ? "submodule"
              : entry.type === "tree"
                ? "dir"
                : "file",
        size: entry.type === "tree" ? null : entry.size,
      }));
      return entries.sort(
        (left, right) =>
          Number(right.type === "dir") - Number(left.type === "dir") ||
          left.name.localeCompare(right.name),
      );
    },
  });
}

function extension(path: string): string {
  return path.split(".").at(-1)?.toLowerCase() ?? "";
}

export function languageForPath(path: string): string | null {
  const name = path.split("/").at(-1)?.toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  return LANGUAGES[extension(path)] ?? null;
}

function rawUrl(owner: string, repo: string, ref: string, path: string): string {
  const refSegments = refKind(ref) === null ? [ref] : ref.split("/");
  return `https://raw.githubusercontent.com/${[owner, repo, ...refSegments, ...path.split("/")].map(encodeURIComponent).join("/")}`;
}

export function useFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
  enabled = true,
): UseQueryResult<FileContent> {
  const { id } = useActiveAccount();
  return useQuery({
    queryKey: codeQueryKey(id, "file", owner, repo, ref, path),
    enabled,
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }): Promise<FileContent> => {
      const kind = refKind(ref);
      const node = required(
        (
          await graphql(
            id,
            fileQuery,
            {
              owner,
              repo,
              ref,
              expression: `${ref}:${path}`,
              branchRef: kind === null ? qualifiedRef("branches", ref) : ref,
            },
            signal,
          )
        ).repository,
      );
      const blob = required(node.object);
      if (blob.__typename !== "Blob") throw gitHubFailure({ kind: "notFound" });
      const size = blob.byteSize;
      const url = rawUrl(owner, repo, ref, path);
      if (size > MAX_FILE_BYTES || blob.isTruncated) return { kind: "tooLarge", size, rawUrl: url };
      const mime = IMAGE_TYPES[extension(path)];
      if (mime) {
        if (!node.isPrivate) return { kind: "image", size, src: url };
        // Text transport would corrupt image bytes.
        const response = await rest<{ content: string; encoding: string }>(id, {
          path: contentsPath(owner, repo, path),
          query: { ref },
          signal,
        });
        if (response.body.encoding !== "base64")
          throw gitHubFailure({ kind: "server", status: response.status });
        // Data URLs survive cache restoration.
        const base64 = response.body.content.replace(/\s/g, "");
        return { kind: "image", size, src: `data:${mime};base64,${base64}` };
      }
      if (blob.isBinary || blob.text === null) return { kind: "binary", size };
      const text = blob.text;
      const lineCount = text === "" ? 0 : text.split("\n").length - Number(text.endsWith("\n"));
      if (lineCount > MAX_FILE_LINES) return { kind: "tooLarge", size, rawUrl: url };
      const head = required(node.head);
      const headOid = "target" in head ? head.target.oid : head.oid;
      // Tags and commits cannot take edits.
      const onBranch =
        kind !== "tags" &&
        head.__typename === "Commit" &&
        node.branch?.prefix === BRANCH_REF_PREFIX &&
        node.branch.target?.oid === head.oid;
      const base = { text, size, lineCount, blobSha: blob.oid, headOid, onBranch };
      if (extension(path) === "md" || extension(path) === "markdown") {
        // GraphQL omits rendered blob HTML.
        const rendered = await rest<string>(id, {
          path: contentsPath(owner, repo, path),
          query: { ref },
          accept: GITHUB_HTML_JSON,
          signal,
          revalidate: true,
        });
        return { kind: "markdown", ...base, html: rendered.body };
      }
      return { kind: "text", ...base, language: languageForPath(path) };
    },
  });
}

export function permalink(
  owner: string,
  repo: string,
  commitOid: string,
  path: string,
  lines?: { start: number; end: number },
): string {
  const base = `https://github.com/${[owner, repo, "blob", commitOid, ...path.split("/")].map(encodeURIComponent).join("/")}`;
  if (!lines) return base;
  return (
    base + `#L${String(lines.start)}` + (lines.start === lines.end ? "" : `-L${String(lines.end)}`)
  );
}

function releaseFrom(node: ResultOf<typeof releaseFragment>, owner: string, repo: string): Release {
  return {
    repo: { owner, name: repo },
    tagName: node.tagName,
    name: node.name ?? node.tagName,
    publishedAt: node.publishedAt ?? node.createdAt,
    isPrerelease: node.isPrerelease,
    author: node.author,
  };
}

export function useReleases(
  owner: string,
  repo: string,
): UseInfiniteQueryResult<InfiniteData<Page<Release>>> {
  const { id } = useActiveAccount();
  return useInfiniteQuery({
    queryKey: accountKey(id, "releases", owner, repo),
    staleTime: STALE_TIME.list,
    meta: PRIVATE_QUERY,
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }): Promise<Page<Release>> => {
      const connection = required(
        (await graphql(id, releasesQuery, { owner, repo, after: pageParam }, signal)).repository,
      ).releases;
      return {
        items: (connection.nodes ?? []).flatMap((release) =>
          release ? [releaseFrom(readFragment(releaseFragment, release), owner, repo)] : [],
        ),
        nextCursor: connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null,
      };
    },
    getNextPageParam: (page) => page.nextCursor,
  });
}

export function useRelease(
  owner: string,
  repo: string,
  tag: string,
): UseQueryResult<ReleaseDetail> {
  const { id } = useActiveAccount();
  return useQuery({
    queryKey: accountKey(id, "release", owner, repo, tag),
    staleTime: STALE_TIME.detail,
    meta: PRIVATE_QUERY,
    queryFn: async ({ signal }) => {
      let after: string | null = null;
      let detail: ReleaseDetail | undefined;
      do {
        const response: ResultOf<typeof releaseQuery> = await graphql(
          id,
          releaseQuery,
          { owner, repo, tag, after },
          signal,
        );
        const release = required(required(response.repository).release);
        const assets = (release.releaseAssets.nodes ?? []).flatMap((asset) => asset ?? []);
        detail = {
          ...releaseFrom(readFragment(releaseFragment, release), owner, repo),
          notesHtml: release.descriptionHTML ?? "",
          webUrl: release.url,
          assets: [...(detail?.assets ?? []), ...assets],
        };
        after = release.releaseAssets.pageInfo.hasNextPage
          ? release.releaseAssets.pageInfo.endCursor
          : null;
      } while (after);
      return detail;
    },
  });
}

export function useRenderMarkdown(): UseMutationResult<
  string,
  GitHubError,
  { text: string; repo?: RepoRef }
> {
  const { id } = useActiveAccount();
  return useMutation({
    retry: false,
    mutationFn: async ({ text, repo }) => {
      // GraphQL does not render arbitrary Markdown.
      const response = await rest<string>(id, {
        path: "/markdown",
        method: "POST",
        body: { text, mode: "gfm", ...(repo ? { context: `${repo.owner}/${repo.name}` } : {}) },
      });
      return response.body;
    },
  });
}
