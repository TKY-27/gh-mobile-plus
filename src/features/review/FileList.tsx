import {
  ChevronRight,
  FileDiff,
  FileMinus,
  FilePlus,
  FileSymlink,
  FileX2,
  Info,
  MessageSquare,
} from "lucide-react";
import { Link } from "react-aria-components/Link";
import { useRouter } from "@tanstack/react-router";
import type { PullRequestDetail } from "@/data/pulls";
import {
  MAX_REVIEW_FILES,
  usePendingReview,
  useSetFileViewed,
  type ChangedFile,
  type PullFiles,
  type ReviewThread,
} from "@/data/review";
import { VirtualList } from "@/ui/VirtualList.tsx";
import { useSheetSession } from "@/ui/sheet-session.ts";
import { pullPath } from "@/features/pull/PullPage.tsx";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { Button } from "@/ui/Button.tsx";
import { Checkbox } from "@/ui/Checkbox.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { SubmitSheet } from "./SubmitSheet.tsx";
import styles from "./Review.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const ROW_ESTIMATE_PX = 64;

const STATUS = {
  added: { icon: FilePlus, tone: "success", label: "review.files.status.added" },
  removed: { icon: FileMinus, tone: "failure", label: "review.files.status.removed" },
  renamed: { icon: FileSymlink, tone: "neutral", label: "review.files.status.renamed" },
  copied: { icon: FileSymlink, tone: "neutral", label: "review.files.status.copied" },
  modified: { icon: FileDiff, tone: "neutral", label: "review.files.status.modified" },
  changed: { icon: FileDiff, tone: "neutral", label: "review.files.status.modified" },
  unchanged: { icon: FileDiff, tone: "neutral", label: "review.files.status.unchanged" },
} as const satisfies Record<
  ChangedFile["status"],
  { icon: unknown; tone: string; label: MessageKey }
>;

export function fileHref(pull: PullRequestDetail, path: string): string {
  return `${pullPath(pull, "files")}?file=${encodeURIComponent(path)}`;
}

export function useViewedToggle(pull: PullRequestDetail) {
  const t = useT();
  const setFileViewed = useSetFileViewed();
  const toggle = (path: string, viewed: boolean) => {
    setFileViewed.mutate(
      {
        pullRequestId: pull.id,
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        path,
        viewed,
      },
      {
        onError: (error) => {
          showErrorToast(t, error, t("review.files.viewedFailed"), () => {
            toggle(path, viewed);
          });
        },
      },
    );
  };
  return toggle;
}

function FileRow(props: {
  pull: PullRequestDetail;
  file: ChangedFile;
  threadCount: number;
  onViewed: (path: string, viewed: boolean) => void;
}) {
  const t = useT();
  const { file } = props;
  const status = STATUS[file.status];
  const Icon = status.icon;
  const slash = file.path.lastIndexOf("/");
  return (
    <div className={styles.fileRow}>
      <Checkbox
        isSelected={file.viewed === "viewed"}
        onChange={(viewed) => {
          props.onViewed(file.path, viewed);
        }}
      >
        <span className={styles.srOnly}>{t("review.files.viewed", { path: file.path })}</span>
      </Checkbox>
      <Link href={fileHref(props.pull, file.path)} className={moduleClass(styles.fileLink)}>
        <span
          className={styles.statusIcon}
          data-tone={status.tone}
          role="img"
          aria-label={t(status.label)}
        >
          <Icon aria-hidden />
        </span>
        <span className={styles.fileText}>
          <span className={styles.fileRowPath}>
            <span className={styles.directory}>{file.path.slice(0, slash + 1)}</span>
            <span className={styles.fileName}>{file.path.slice(slash + 1)}</span>
          </span>
          <span className={styles.fileMeta}>
            <span className={styles.additions}>+{file.additions}</span>
            <span className={styles.deletions}>−{file.deletions}</span>
            {file.hunks === null ? <span>{t("review.files.tooLarge")}</span> : null}
            {props.threadCount > 0 ? (
              <span className={styles.threadCount}>
                <MessageSquare aria-hidden />
                {t("review.files.comments", { count: props.threadCount })}
              </span>
            ) : null}
          </span>
        </span>
        <ChevronRight className={styles.chevron} aria-hidden />
      </Link>
    </div>
  );
}

export function FileList(props: {
  pull: PullRequestDetail;
  files: PullFiles;
  threads: readonly ReviewThread[];
}) {
  const t = useT();
  const formatters = useFormatters();
  const { pull, files } = props;
  const pending = usePendingReview(pull.repo.owner, pull.repo.name, pull.number);
  const onViewed = useViewedToggle(pull);
  const submit = useSheetSession<null>();
  const router = useRouter();
  const viewed = files.files.filter((file) => file.viewed === "viewed").length;
  const total = files.files.length;
  const threadCounts = new Map<string, number>();
  for (const thread of props.threads) {
    threadCounts.set(thread.path, (threadCounts.get(thread.path) ?? 0) + 1);
  }

  if (total === 0) {
    return (
      <EmptyState
        icon={<FileX2 />}
        title={t("review.files.emptyTitle")}
        message={t("review.files.emptyMessage")}
      />
    );
  }
  return (
    <>
      <div className={styles.progress}>
        <p className={styles.progressText}>
          {t("review.files.progress", {
            viewed: formatters.number(viewed),
            total: formatters.number(total),
          })}
        </p>
        <span className={styles.progressTrack} aria-hidden>
          <span
            className={styles.progressFill}
            style={{ width: `${String((viewed / total) * 100)}%` }}
          />
        </span>
        <Button
          variant="primary"
          onPress={() => {
            submit.open(null);
          }}
        >
          {pending.comments.length > 0
            ? t("review.bar.reviewCount", { count: pending.comments.length })
            : t("review.bar.review")}
        </Button>
      </div>
      {files.truncated ? (
        <Banner icon={<Info />}>
          {t("review.files.truncated", {
            total: formatters.number(files.totalFiles),
            shown: formatters.number(MAX_REVIEW_FILES),
          })}
        </Banner>
      ) : null}
      <VirtualList
        label={t("review.files.label")}
        items={files.files}
        getKey={(file) => file.path}
        estimateSize={() => ROW_ESTIMATE_PX}
        renderItem={(file) => (
          <FileRow
            pull={pull}
            file={file}
            threadCount={threadCounts.get(file.path) ?? 0}
            onViewed={onViewed}
          />
        )}
      />
      {submit.sheet ? (
        <SubmitSheet
          key={submit.sheet.session}
          pull={pull}
          commitOid={files.headOid}
          baseOid={files.baseOid}
          pending={pending}
          isOpen={submit.sheet.open}
          onOpenChange={submit.setOpen}
          onShowComment={(comment) => {
            submit.setOpen(false);
            router.history.push(fileHref(pull, comment.path));
          }}
        />
      ) : null}
    </>
  );
}
