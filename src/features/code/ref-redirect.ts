import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { useIsTopScreen, useScreen } from "@/app/navigation/screen.ts";
import { refKind } from "@/data/links";
import { useResolvedRefPath } from "@/data/repo";
import { blobPath, treePath } from "./paths.ts";

export function useRefRedirect(
  kind: "tree" | "blob",
  owner: string,
  repo: string,
  ref: string,
  path: string,
) {
  const router = useRouter();
  const { href } = useScreen();
  const isTop = useIsTopScreen();
  const enabled = refKind(ref) === null;
  const resolution = useResolvedRefPath(owner, repo, ref, path, kind, enabled);
  const resolved = enabled ? resolution.resolvedPath : null;
  useEffect(() => {
    if (!isTop || !resolved || resolved.path === path) return;
    const toPath = kind === "tree" ? treePath : blobPath;
    const { search, hash } = new URL(href, window.location.origin);
    router.history.replace(toPath(owner, repo, resolved.ref, resolved.path) + search + hash);
  }, [href, isTop, kind, owner, path, repo, resolved, router]);
  const exact = resolved?.path === path;
  return {
    ref: exact ? resolved.ref : ref,
    ready: !enabled || exact || resolved === null,
    error: enabled ? resolution.error : null,
    retry: resolution.refetch,
  };
}
