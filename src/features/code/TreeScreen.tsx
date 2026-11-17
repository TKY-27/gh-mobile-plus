import { File, FileSymlink, Folder, FolderGit2, FolderOpen } from "lucide-react";
import { Link } from "react-aria-components/Link";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { treeRoute } from "@/app/router.ts";
import { useTree, type TreeEntry } from "@/data/repo";
import { useT } from "@/i18n/index.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { blobPath, treePath } from "./paths.ts";
import { useRefRedirect } from "./ref-redirect.ts";
import { useFormatSize } from "./size.ts";
import styles from "./TreeScreen.module.css";

const ROW_ESTIMATE_PX = 48;
const SKELETON_ROWS = 8;

const ICONS = { dir: Folder, file: File, symlink: FileSymlink, submodule: FolderGit2 } as const;

function TreeRow(props: { owner: string; repo: string; gitRef: string; entry: TreeEntry }) {
  const t = useT();
  const formatSize = useFormatSize();
  const { entry } = props;
  const Icon = ICONS[entry.type];
  const content = (
    <>
      <Icon className={styles.icon} data-type={entry.type} aria-hidden />
      <span className={styles.name}>{entry.name}</span>
      {entry.type === "submodule" ? (
        <span className={styles.detail}>{t("code.tree.submodule")}</span>
      ) : entry.size === null ? null : (
        <span className={styles.detail}>{formatSize(entry.size)}</span>
      )}
    </>
  );
  if (entry.type === "submodule") return <div className={styles.row}>{content}</div>;
  const toPath = entry.type === "dir" ? treePath : blobPath;
  return (
    <Link
      href={toPath(props.owner, props.repo, props.gitRef, entry.path)}
      className={moduleClass(styles.row)}
    >
      {content}
    </Link>
  );
}

export default function TreeScreen() {
  const t = useT();
  const { owner, repo, ref: urlRef, _splat: path = "" } = useScreenParams(treeRoute);
  const redirect = useRefRedirect("tree", owner, repo, urlRef, path);
  const ref = redirect.ref;
  const tree = useTree(owner, repo, ref, path, redirect.ready);
  const title = path.split("/").at(-1) || repo;
  const error = redirect.error ?? (redirect.ready ? tree.error : null);

  let body;
  if (error) {
    body = (
      <ErrorState
        error={error}
        fullScreen={isFullScreenError(error)}
        onRetry={() => void (redirect.error ? redirect.retry() : tree.refetch())}
      />
    );
  } else if (!redirect.ready || tree.isPending) {
    body = (
      <div className={styles.skeleton} aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} width="100%" height="2rem" />
        ))}
      </div>
    );
  } else if (tree.data?.length === 0) {
    body = (
      <EmptyState
        icon={<FolderOpen />}
        title={t("code.tree.empty")}
        message={t("code.tree.emptyMessage")}
      />
    );
  } else if (tree.data) {
    body = (
      <VirtualList
        separators
        items={tree.data}
        label={t("code.tree.label")}
        estimateSize={ROW_ESTIMATE_PX}
        getKey={(entry) => entry.path}
        renderItem={(entry) => <TreeRow owner={owner} repo={repo} gitRef={ref} entry={entry} />}
      />
    );
  }

  return (
    <Page title={title}>
      {redirect.ready ? (
        <Breadcrumb owner={owner} repo={repo} gitRef={ref} path={path} kind="tree" />
      ) : null}
      {body}
    </Page>
  );
}
