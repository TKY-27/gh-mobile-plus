import { lazy, Suspense } from "react";
import { Page } from "@/app/Page.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { jobRoute } from "@/app/router.ts";
import { LOGS_READABLE, useWorkflowRun } from "@/data/actions";
import { useT } from "@/i18n/index.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { ListSection } from "@/ui/ListRow.tsx";
import { LiveLogNotice } from "./LiveLogNotice.tsx";
import { JobRow, StepRows } from "./RunScreen.tsx";

const LogViewer = lazy(() => import("./LogViewer.tsx"));
const NOT_FOUND = { kind: "notFound" } as const;

export default function JobScreen() {
  const t = useT();
  const { owner, repo, runId, jobId } = useScreenParams(jobRoute);
  const query = useWorkflowRun(owner, repo, runId);
  const job = query.data?.jobs.find((each) => each.id === jobId);

  let body;
  if (query.isPending) body = <ScreenSkeleton />;
  else if (query.isError) {
    body = (
      <ErrorState
        error={query.error}
        fullScreen={isFullScreenError(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  } else if (!job) body = <ErrorState error={NOT_FOUND} fullScreen />;
  else {
    const completed = job.status === "completed";
    body = (
      <>
        <ListSection>
          <JobRow job={job} />
          {completed ? null : <StepRows steps={job.steps} />}
        </ListSection>
        {!completed ? (
          <LiveLogNotice job={job} reason="running" />
        ) : LOGS_READABLE ? (
          <Suspense fallback={<ScreenSkeleton />}>
            <LogViewer owner={owner} repo={repo} job={job} />
          </Suspense>
        ) : (
          <LiveLogNotice job={job} reason="unreadable" />
        )}
      </>
    );
  }
  return <Page title={job?.name ?? t("actions.job.fallbackTitle")}>{body}</Page>;
}
