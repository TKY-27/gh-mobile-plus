import { FileQuestion } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { useScreen, useScreenParams } from "@/app/navigation/screen.ts";
import { pullFilesRoute } from "@/app/router.ts";
import { usePullRequest, type PullRequestDetail } from "@/data/pulls";
import { usePullFiles, useReviewThreads } from "@/data/review";
import { PullGate, PullPage, pullPath } from "@/features/pull/PullPage.tsx";
import { useT } from "@/i18n/index.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { FileList } from "./FileList.tsx";
import { FileReview } from "./FileReview.tsx";
import styles from "./Review.module.css";

const FILE_PARAM = "file";

function Review(props: {
  pull: PullRequestDetail;
  path: string | null;
  files: ReturnType<typeof usePullFiles>;
  threads: ReturnType<typeof useReviewThreads>;
}) {
  const t = useT();
  const { pull, path, files, threads } = props;
  const failed = files.isError ? files : threads.isError ? threads : null;
  const placeholder = failed ? (
    <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
  ) : (
    <div className={styles.loading} aria-busy="true">
      <ScreenSkeleton />
    </div>
  );

  if (path === null) {
    return (
      <PullPage pull={pull} tab="files">
        {files.isSuccess && threads.isSuccess ? (
          <FileList pull={pull} files={files.data} threads={threads.data} />
        ) : (
          placeholder
        )}
      </PullPage>
    );
  }
  if (!files.isSuccess || !threads.isSuccess) {
    return <Page title={path.slice(path.lastIndexOf("/") + 1)}>{placeholder}</Page>;
  }
  const file = files.data.files.find((candidate) => candidate.path === path);
  if (!file) {
    return (
      <Page title={path}>
        <EmptyState
          icon={<FileQuestion />}
          title={t("review.files.missingTitle")}
          message={t("review.files.missingMessage")}
        />
        <ListSection>
          <ListRow title={t("review.files.backToFiles")} href={pullPath(pull, "files")} />
        </ListSection>
      </Page>
    );
  }
  return <FileReview pull={pull} files={files.data} threads={threads.data} file={file} />;
}

export default function ReviewScreen() {
  const { href } = useScreen();
  const { owner, repo, number } = useScreenParams(pullFilesRoute);
  const pull = usePullRequest(owner, repo, number);
  const pullOwner = pull.data?.repo.owner ?? owner;
  const pullRepo = pull.data?.repo.name ?? repo;
  const files = usePullFiles(pullOwner, pullRepo, number);
  const threads = useReviewThreads(pullOwner, pullRepo, number);
  // The router JSON-parses names like "1".
  const path = new URL(href, window.location.origin).searchParams.get(FILE_PARAM);
  return (
    <PullGate query={pull} number={number}>
      {(detail) => <Review pull={detail} path={path} files={files} threads={threads} />}
    </PullGate>
  );
}
