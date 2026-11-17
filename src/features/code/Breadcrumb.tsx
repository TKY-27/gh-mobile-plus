import { useLayoutEffect, useRef, useState } from "react";
import { ChevronsUpDown, GitBranch, Tag } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "react-aria-components/Button";
import { Link } from "react-aria-components/Link";
import { refKind, refName } from "@/data/links";
import { RefSheet } from "@/features/repo/RefSheet.tsx";
import { useT } from "@/i18n/index.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { blobPath, treePath } from "./paths.ts";
import styles from "./Breadcrumb.module.css";

export function Breadcrumb(props: {
  owner: string;
  repo: string;
  gitRef: string;
  path: string;
  kind: "tree" | "blob";
}) {
  const t = useT();
  const router = useRouter();
  const list = useRef<HTMLOListElement | null>(null);
  const [choosingRef, setChoosingRef] = useState(false);
  const currentRefName = refName(props.gitRef);
  const RefIcon = refKind(props.gitRef) === "tags" ? Tag : GitBranch;
  const segments = props.path ? props.path.split("/") : [];
  const crumbs = [
    { name: props.repo, path: "" },
    ...segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join("/") })),
  ];

  useLayoutEffect(() => {
    const element = list.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [props.path]);

  return (
    <nav className={styles.breadcrumb} aria-label={t("code.breadcrumb")}>
      <Button
        className={moduleClass(styles.refButton)}
        aria-label={t("repo.refs.switchFrom", { ref: currentRefName })}
        onPress={() => {
          setChoosingRef(true);
        }}
      >
        <span className={styles.ref}>
          <RefIcon aria-hidden />
          <span className={styles.refName}>{currentRefName}</span>
          <ChevronsUpDown aria-hidden />
        </span>
      </Button>
      <ol ref={list} className={styles.list}>
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <li key={crumb.path} className={styles.crumb}>
              {current ? (
                <span className={styles.current} aria-current="page">
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={treePath(props.owner, props.repo, props.gitRef, crumb.path)}
                  className={moduleClass(styles.link)}
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {choosingRef ? (
        <RefSheet
          owner={props.owner}
          repo={props.repo}
          current={props.gitRef}
          onSelect={(ref) => {
            setChoosingRef(false);
            const toPath = props.kind === "tree" ? treePath : blobPath;
            if (ref !== props.gitRef)
              router.history.push(toPath(props.owner, props.repo, ref, props.path));
          }}
          onClose={() => {
            setChoosingRef(false);
          }}
        />
      ) : null}
    </nav>
  );
}
