const GITHUB_ORIGIN = "https://github.com";
const GITHUB_HOSTS: ReadonlySet<string> = new Set(["github.com", "www.github.com"]);
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const MENTION = /^@([^/\s]+)$/;
const REFERENCE = /^([^/\s]+)\/([^/\s#]+)#(\d+)$/;
const REPO_NAME = /^([^/\s]+)\/([^/\s]+)$/;
const REF_PREFIXES = { branches: "refs/heads/", tags: "refs/tags/" };
// Avoid treating reserved paths as users.
const RESERVED_OWNERS: ReadonlySet<string> = new Set([
  "__diagnostics",
  "about",
  "account",
  "apps",
  "auth",
  "codespaces",
  "collections",
  "dashboard",
  "enterprise",
  "explore",
  "features",
  "issues",
  "join",
  "login",
  "logout",
  "marketplace",
  "new",
  "notifications",
  "organizations",
  "orgs",
  "pricing",
  "pulls",
  "repositories",
  "search",
  "sessions",
  "settings",
  "signin",
  "signup",
  "sponsors",
  "topics",
  "trending",
  "welcome",
]);
const REPO_ROUTES: readonly RegExp[] = [
  /^$/,
  /^tree\/[^/]+(\/.+)?$/,
  /^blob\/[^/]+\/.+$/,
  /^issues(\/new|\/\d+)?$/,
  /^pulls$/,
  /^pull\/\d+(\/(files|checks|commits))?$/,
  /^actions(\/runs\/\d+(\/job\/\d+)?)?$/,
  /^releases(\/tag\/[^/]+)?$/,
  /^commit\/[0-9a-f]{7,40}$/i,
];

function isOwner(owner: string): boolean {
  return OWNER.test(owner) && !RESERVED_OWNERS.has(owner.toLowerCase());
}

function repoPath(owner: string, repo: string, rest: string, hash: string): string | null {
  if (!isOwner(owner) || !REPO.test(repo)) return null;
  if (!REPO_ROUTES.some((route) => route.test(rest))) return null;
  return `/${owner}/${repo}${rest ? `/${rest}` : ""}${hash}`;
}

function fromUrl(text: string): string | null {
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  const webScheme = url.protocol === "https:" || url.protocol === "http:";
  if (!webScheme || !GITHUB_HOSTS.has(url.hostname) || url.port || url.username) return null;
  const [owner, repo, ...rest] = url.pathname.split("/").filter(Boolean);
  if (owner === undefined) return "/";
  if (owner === "notifications" && repo === undefined && !url.search && !url.hash) {
    return "/notifications";
  }
  if (repo === undefined) return isOwner(owner) ? `/${owner}` : null;
  return repoPath(owner, repo, rest.join("/"), url.hash);
}

export function toAppPath(input: string): string | null {
  const text = input.trim();
  const mention = MENTION.exec(text);
  if (mention?.[1] !== undefined) return isOwner(mention[1]) ? `/${mention[1]}` : null;
  const reference = REFERENCE.exec(text);
  if (reference?.[1] !== undefined && reference[2] !== undefined && reference[3] !== undefined) {
    return repoPath(reference[1], reference[2], `issues/${reference[3]}`, "");
  }
  const repo = REPO_NAME.exec(text);
  if (repo?.[1] !== undefined && repo[2] !== undefined) return repoPath(repo[1], repo[2], "", "");
  return fromUrl(text);
}

type RefKind = keyof typeof REF_PREFIXES;

export function qualifiedRef(kind: RefKind, name: string): string {
  return REF_PREFIXES[kind] + name;
}

export function refKind(ref: string): RefKind | null {
  if (ref.startsWith(REF_PREFIXES.branches)) return "branches";
  if (ref.startsWith(REF_PREFIXES.tags)) return "tags";
  return null;
}

export function refName(ref: string): string {
  const kind = refKind(ref);
  return kind === null ? ref : ref.slice(REF_PREFIXES[kind].length);
}

export function* refPathCandidates(ref: string, path: string, kind: "tree" | "blob") {
  if (path === "" || ref.includes("/")) return;
  const segments = path.split("/");
  const longest = segments.length - Number(kind === "blob");
  for (let count = longest; count >= 1; count--) {
    yield {
      ref: [ref, ...segments.slice(0, count)].join("/"),
      path: segments.slice(count).join("/"),
    };
  }
}

export function githubUrl(appPath: string): string {
  if (!appPath.startsWith("/") || appPath.startsWith("//") || appPath.includes("\\")) {
    throw new Error("App paths must be root-relative");
  }
  return new URL(appPath, GITHUB_ORIGIN).href;
}
