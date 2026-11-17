import { CircleCheckBig, ExternalLink } from "lucide-react";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { pullChecksRoute } from "@/app/router.ts";
import { useChecks, usePullRequest, type CheckRun, type PullRequestDetail } from "@/data/pulls";
import { formatDuration } from "@/features/actions/run-status.ts";
import { useT } from "@/i18n/index.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { openExternal } from "@/ui/external.ts";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { useNow } from "@/ui/RelativeTime.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { StatusIcon } from "@/ui/StatusIcon.tsx";
import { checkRunState, countByGroup, statusContextState } from "./check-state.ts";
import { PullGate, PullPage } from "./PullPage.tsx";
import styles from "./Pull.module.css";

const ICON_PX = 20;
const SKELETON_ROWS = 4;

function CheckRow(props: { pull: PullRequestDetail; run: CheckRun }) {
  const t = useT();
  const now = useNow();
  const { pull, run } = props;
  const state = checkRunState(run);
  const duration = formatDuration(t, run.startedAt, run.completedAt, now);
  const subtitle = duration ? `${t(state.label)} · ${duration}` : t(state.label);
  const leading = (
    <span aria-hidden>
      <StatusIcon status={state.icon} size={ICON_PX} />
    </span>
  );
  if (run.actionsJob) {
    const { runId, jobId } = run.actionsJob;
    return (
      <ListRow
        leading={leading}
        title={run.name}
        subtitle={subtitle}
        href={`/${pull.repo.owner}/${pull.repo.name}/actions/runs/${String(runId)}/job/${String(jobId)}`}
      />
    );
  }
  const { detailsUrl } = run;
  return (
    <ListRow
      leading={leading}
      title={run.name}
      subtitle={subtitle}
      {...(detailsUrl
        ? {
            trailing: <ExternalLink className={styles.externalIcon} aria-hidden />,
            onPress: () => {
              openExternal(detailsUrl);
            },
          }
        : {})}
    />
  );
}

function Checks(props: { pull: PullRequestDetail; checks: ReturnType<typeof useChecks> }) {
  const t = useT();
  const { pull, checks } = props;

  if (checks.isPending) {
    return (
      <div className={styles.skeleton} aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} width="100%" height="3rem" />
        ))}
      </div>
    );
  }
  if (checks.isError) {
    return <ErrorState error={checks.error} onRetry={() => void checks.refetch()} />;
  }
  const { suites, statuses } = checks.data;
  const states = [
    ...suites.flatMap((suite) => suite.runs.map(checkRunState)),
    ...statuses.map((status) => statusContextState(status.state)),
  ];
  if (states.length === 0) {
    return (
      <EmptyState
        icon={<CircleCheckBig />}
        title={t("pull.checks.emptyTitle")}
        message={t("pull.checks.emptyMessage")}
      />
    );
  }
  const counts = countByGroup(states);
  const summary = [
    counts.failing > 0 ? t("pull.checks.failing", { count: counts.failing }) : null,
    counts.pending > 0 ? t("pull.checks.pending", { count: counts.pending }) : null,
    counts.passing > 0 ? t("pull.checks.passing", { count: counts.passing }) : null,
    counts.skipped > 0 ? t("pull.checks.skipped", { count: counts.skipped }) : null,
  ].filter((part) => part !== null);

  return (
    <>
      <p className={styles.checksSummary} role="status">
        {summary.join(" · ")}
      </p>
      {suites.map((suite, index) => (
        <ListSection key={`${suite.app}:${String(index)}`} title={suite.workflowName ?? suite.app}>
          {suite.runs.map((run) => (
            <CheckRow key={run.id} pull={pull} run={run} />
          ))}
        </ListSection>
      ))}
      {statuses.length > 0 ? (
        <ListSection title={t("pull.checks.statuses")}>
          {statuses.map((status) => {
            const state = statusContextState(status.state);
            const { targetUrl } = status;
            return (
              <ListRow
                key={status.context}
                leading={
                  <span aria-hidden>
                    <StatusIcon status={state.icon} size={ICON_PX} />
                  </span>
                }
                title={status.context}
                subtitle={status.description ?? t(state.label)}
                {...(targetUrl
                  ? {
                      trailing: <ExternalLink className={styles.externalIcon} aria-hidden />,
                      onPress: () => {
                        openExternal(targetUrl);
                      },
                    }
                  : {})}
              />
            );
          })}
        </ListSection>
      ) : null}
    </>
  );
}

export default function ChecksScreen() {
  const { owner, repo, number } = useScreenParams(pullChecksRoute);
  const pull = usePullRequest(owner, repo, number);
  const pullOwner = pull.data?.repo.owner ?? owner;
  const pullRepo = pull.data?.repo.name ?? repo;
  const checks = useChecks(pullOwner, pullRepo, number);
  return (
    <PullGate query={pull} number={number}>
      {(detail) => (
        <PullPage pull={detail} tab="checks">
          <Checks pull={detail} checks={checks} />
        </PullPage>
      )}
    </PullGate>
  );
}
