import { useMemo, useRef } from "react";
import { ExternalLink, FileSearch, FileX2, GitCommitHorizontal, WrapText } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { commitRoute } from "@/app/router.ts";
import { useCommit, type CommitDetail } from "@/data/commits";
import { setPreferences, usePreferences } from "@/data/preferences";
import type { ChangedFile } from "@/data/review";
import { SinglePickerSheet } from "@/features/issue/PickerSheet.tsx";
import { useSheetSession } from "@/ui/sheet-session.ts";
import { openExternal } from "@/ui/external.ts";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { commitRows, type DiffRow } from "../diff-rows.ts";
import { DiffList, type DiffListHandle } from "../DiffList.tsx";
import styles from "./Commit.module.css";

const SHORT_OID_LENGTH = 7;
const AVATAR_PX = 28;

function FileHeader(props: { file: ChangedFile }) {
  const { file } = props;
  return (
    <h2 className={styles.fileHeader} tabIndex={-1}>
      <span className={styles.filePath}>{file.path}</span>
      <span className={styles.counts}>
        <span className={styles.additions}>+{file.additions}</span>
        <span className={styles.deletions}>−{file.deletions}</span>
      </span>
    </h2>
  );
}

function FileMessage(props: { row: Extract<DiffRow, { kind: "message" }> }) {
  const t = useT();
  const { file, reason } = props.row;
  return (
    <div className={styles.message}>
      <FileX2 aria-hidden />
      <p>{reason === "tooLarge" ? t("review.diff.tooLargeTitle") : t("review.diff.noTextTitle")}</p>
      {reason === "tooLarge" ? (
        <Button
          variant="plain"
          icon={<ExternalLink aria-hidden />}
          onPress={() => {
            openExternal(file.blobUrl);
          }}
        >
          {t("common.openOnGitHub")}
        </Button>
      ) : null}
    </div>
  );
}

function Commit(props: { commit: CommitDetail }) {
  const t = useT();
  const preferences = usePreferences();
  const { commit } = props;
  const diff = useRef<DiffListHandle | null>(null);
  const jump = useSheetSession<null>();
  const rows = useMemo(() => commitRows(commit.files), [commit.files]);
  const author = commit.author?.login ?? commit.authorName;

  return (
    <Page
      title={commit.messageHeadline}
      largeTitle
      menuActions={[
        {
          id: "jump",
          label: t("review.commit.jump"),
          icon: <FileSearch aria-hidden />,
          onAction: () => {
            jump.open(null);
          },
        },
        {
          id: "wrap",
          label: preferences.softWrap ? t("review.commit.unwrap") : t("review.commit.wrap"),
          icon: <WrapText aria-hidden />,
          onAction: () => {
            setPreferences({ softWrap: !preferences.softWrap });
          },
        },
      ]}
    >
      <div className={styles.header}>
        <p className={styles.author}>
          <Avatar src={commit.author?.avatarUrl ?? null} name={author} size={AVATAR_PX} />
          <span>
            <strong>{author}</strong> <RelativeTime date={commit.committedAt} />
          </span>
        </p>
        {commit.messageBody ? <p className={styles.body}>{commit.messageBody}</p> : null}
        <p className={styles.meta}>
          <GitCommitHorizontal aria-hidden />
          <code>{commit.oid.slice(0, SHORT_OID_LENGTH)}</code>
          <span>{t("review.commit.files", { count: commit.files.length })}</span>
          <span className={styles.additions}>+{commit.additions}</span>
          <span className={styles.deletions}>−{commit.deletions}</span>
        </p>
      </div>
      <DiffList
        ref={diff}
        label={t("review.commit.label")}
        rows={rows}
        path={null}
        softWrap={preferences.softWrap}
        stickyInset={0}
        renderFile={(file) => <FileHeader file={file} />}
        renderMessage={(row) => <FileMessage row={row} />}
      />
      {jump.sheet ? (
        <SinglePickerSheet
          key={jump.sheet.session}
          isOpen={jump.sheet.open}
          onOpenChange={jump.setOpen}
          title={t("review.commit.jump")}
          options={commit.files.map((file) => ({ id: file.path, label: file.path }))}
          emptyMessage={t("review.files.emptyTitle")}
          selected={null}
          onSelect={(path) => {
            const index = rows.findIndex((row) => row.kind === "file" && row.file.path === path);
            if (index >= 0) diff.current?.focusRow(index, "start");
          }}
        />
      ) : null}
    </Page>
  );
}

export default function CommitScreen() {
  const { owner, repo, sha } = useScreenParams(commitRoute);
  const commit = useCommit(owner, repo, sha);
  if (commit.isSuccess) return <Commit commit={commit.data} />;
  const title = sha.slice(0, SHORT_OID_LENGTH);
  return (
    <Page title={title}>
      {commit.isPending ? (
        <ScreenSkeleton />
      ) : (
        <ErrorState
          error={commit.error}
          fullScreen={isFullScreenError(commit.error)}
          onRetry={() => void commit.refetch()}
        />
      )}
    </Page>
  );
}
