function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function repoRoute(
  kind: "tree" | "blob" | "edit",
  owner: string,
  repo: string,
  ref: string,
  path: string,
) {
  const base = `/${owner}/${repo}/${kind}/${encodeURIComponent(ref)}`;
  return path ? `${base}/${encodePath(path)}` : base;
}

export function treePath(owner: string, repo: string, ref: string, path: string): string {
  return repoRoute("tree", owner, repo, ref, path);
}

export function blobPath(owner: string, repo: string, ref: string, path: string): string {
  return repoRoute("blob", owner, repo, ref, path);
}

export function editPath(owner: string, repo: string, ref: string, path: string): string {
  return repoRoute("edit", owner, repo, ref, path);
}
