import { useState } from "react";
import { CircleStop, GitBranch, RotateCcw } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { runRoute } from "@/app/router.ts";
import {
  useCancelRun,
  useRerunRun,
  useWorkflowRun,
  type Job,
  type JobStep,
  type WorkflowRun,
} from "@/data/actions";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { useNow } from "@/ui/RelativeTime.tsx";
import { StatusIcon } from "@/ui/StatusIcon.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { ConfirmSheet } from "@/ui/ConfirmSheet.tsx";
import { eventLabel, formatDuration, runState } from "./run-status.ts";
import { RunByline } from "./RunRow.tsx";
import styles from "./Actions.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const HEADER_ICON_PX = 28;
const JOB_ICON_PX = 20;
const STEP_ICON_PX = 14;
const FAILED: ReadonlySet<string> = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "startup_failure",
]);

export function JobRow(props: { job: Job; href?: string }) {
  const t = useT();
  const now = useNow();
  const { job } = props;
  const state = runState(job.status, job.conclusion);
  const duration = formatDuration(t, job.startedAt, job.completedAt, now);
  return (
    <ListRow
      leading={<StatusIcon status={state.icon} size={JOB_ICON_PX} />}
      title={job.name}
      subtitle={duration ? `${t(state.label)} · ${duration}` : t(state.label)}
      {...(props.href ? { href: props.href } : {})}
    />
  );
}

export function StepRows(props: { steps: readonly JobStep[] }) {
  const t = useT();
  const now = useNow();
  return props.steps.map((step) => {
    const state = runState(step.status, step.conclusion);
    const duration = formatDuration(t, step.startedAt, step.completedAt, now);
    return (
      <li key={step.number} className={styles.step}>
        <StatusIcon status={state.icon} size={STEP_ICON_PX} />
        <span className={styles.stepName}>{step.name}</span>
        <span className={styles.stepTime}>{duration ?? t(state.label)}</span>
      </li>
    );
  });
}

function RunHeader(props: { run: WorkflowRun }) {
  const t = useT();
  const now = useNow();
  const { run } = props;
  const state = runState(run.status, run.conclusion);
  const ended = run.status === "completed" ? run.updatedAt : null;
  const duration = formatDuration(t, run.runStartedAt, ended, now);
  return (
    <header className={styles.header}>
      <div className={styles.headerTitle}>
        <StatusIcon status={state.icon} size={HEADER_ICON_PX} />
        <h2 className={styles.title}>{run.displayTitle}</h2>
      </div>
      <p className={styles.runMeta}>
        {t("actions.run.number", { workflow: run.name, number: run.runNumber })} ·{" "}
        {eventLabel(t, run.event)}
      </p>
      <p className={styles.runMeta}>
        <span className={styles.state} data-status={state.icon}>
          {t(state.label)}
        </span>
        {duration ? <span>{duration}</span> : null}
        {run.branch ? (
          <span className={styles.branch}>
            <GitBranch aria-hidden />
            {run.branch}
          </span>
        ) : null}
      </p>
      <p className={styles.runMeta}>
        <RunByline run={run} />
      </p>
    </header>
  );
}

function RunActions(props: {
  owner: string;
  repo: string;
  run: WorkflowRun;
  jobs: readonly Job[];
}) {
  const t = useT();
  const rerun = useRerunRun();
  const cancel = useCancelRun();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { owner, repo, run } = props;
  const completed = run.status === "completed";
  const hasFailedJobs = props.jobs.some(
    (job) => job.conclusion !== null && FAILED.has(job.conclusion),
  );

  const requestRerun = (failedOnly: boolean) => {
    rerun.mutate(
      { owner, repo, runId: run.id, failedOnly },
      {
        onSuccess: () => {
          showToast(t("actions.run.rerunStarted"));
        },
        onError: (error) => {
          showErrorToast(t, error, t("actions.run.rerunError"), () => {
            requestRerun(failedOnly);
          });
        },
      },
    );
  };
  const requestCancel = () => {
    cancel.mutate(
      { owner, repo, runId: run.id },
      {
        onSuccess: () => {
          showToast(t("actions.run.cancelRequested"));
        },
        onError: (error) => {
          showErrorToast(t, error, t("actions.run.cancelFailed"), requestCancel);
        },
      },
    );
  };

  return (
    <div className={styles.runActions}>
      {completed && hasFailedJobs ? (
        <Button
          variant="primary"
          icon={<RotateCcw aria-hidden />}
          isPending={rerun.isPending && rerun.variables.failedOnly}
          isDisabled={rerun.isPending}
          onPress={() => {
            requestRerun(true);
          }}
        >
          {t("actions.run.rerunFailedJobs")}
        </Button>
      ) : null}
      {completed ? (
        <Button
          icon={<RotateCcw aria-hidden />}
          isPending={rerun.isPending && !rerun.variables.failedOnly}
          isDisabled={rerun.isPending}
          onPress={() => {
            requestRerun(false);
          }}
        >
          {t("actions.run.rerunAll")}
        </Button>
      ) : (
        <Button
          variant="destructive"
          icon={<CircleStop aria-hidden />}
          isPending={cancel.isPending}
          onPress={() => {
            setConfirmCancel(true);
          }}
        >
          {t("actions.run.cancel")}
        </Button>
      )}
      <ConfirmSheet
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("actions.run.cancelTitle", { number: run.runNumber })}
        message={t("actions.run.cancelMessage")}
        confirmLabel={t("actions.run.cancel")}
        destructive
        onConfirm={requestCancel}
      />
    </div>
  );
}

export default function RunScreen() {
  const t = useT();
  const { owner, repo, runId } = useScreenParams(runRoute);
  const query = useWorkflowRun(owner, repo, runId);
  const title = query.data
    ? t("actions.run.title", { number: query.data.run.runNumber })
    : t("actions.run.fallbackTitle");

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
  } else {
    const { run, jobs } = query.data;
    body = (
      <>
        <RunHeader run={run} />
        <RunActions owner={owner} repo={repo} run={run} jobs={jobs} />
        {jobs.length === 0 ? <p className={styles.sheetNote}>{t("actions.run.noJobs")}</p> : null}
        {jobs.map((job) => {
          return (
            <ListSection key={job.id}>
              <JobRow
                job={job}
                href={`/${owner}/${repo}/actions/runs/${String(runId)}/job/${String(job.id)}`}
              />
              <StepRows steps={job.steps} />
            </ListSection>
          );
        })}
      </>
    );
  }
  return <Page title={title}>{body}</Page>;
}
