import type { RunConclusion, RunStatus } from "@/data/actions";
import type { MessageKey, Translate } from "@/i18n/index.tsx";
import type { Status } from "@/ui/StatusIcon.tsx";
import { MINUTE_MS, SECOND_MS } from "@/ui/time.ts";

const MINUTE_S = MINUTE_MS / SECOND_MS;
const HOUR_S = 60 * MINUTE_S;

export interface RunState {
  icon: Status;
  label: MessageKey;
}

const PENDING_LABELS: Readonly<Record<Exclude<RunStatus, "completed">, MessageKey>> = {
  queued: "actions.status.queued",
  in_progress: "actions.status.inProgress",
  waiting: "actions.status.waiting",
  requested: "actions.status.queued",
  pending: "actions.status.queued",
};

const COMPLETED: Readonly<Record<NonNullable<RunConclusion>, RunState>> = {
  success: { icon: "success", label: "actions.status.success" },
  failure: { icon: "failure", label: "actions.status.failure" },
  timed_out: { icon: "failure", label: "actions.status.timedOut" },
  startup_failure: { icon: "failure", label: "actions.status.startupFailure" },
  cancelled: { icon: "closed", label: "actions.status.cancelled" },
  action_required: { icon: "pending", label: "actions.status.actionRequired" },
  skipped: { icon: "draft", label: "actions.status.skipped" },
  neutral: { icon: "draft", label: "actions.status.neutral" },
  stale: { icon: "draft", label: "actions.status.stale" },
};

export function runState(status: RunStatus, conclusion: RunConclusion): RunState {
  if (status !== "completed") return { icon: "pending", label: PENDING_LABELS[status] };
  return conclusion === null
    ? { icon: "draft", label: "actions.status.neutral" }
    : COMPLETED[conclusion];
}

const EVENT_LABELS: Readonly<Record<string, MessageKey>> = {
  push: "actions.event.push",
  pull_request: "actions.event.pullRequest",
  pull_request_target: "actions.event.pullRequestTarget",
  workflow_dispatch: "actions.event.workflowDispatch",
  workflow_run: "actions.event.workflowRun",
  repository_dispatch: "actions.event.repositoryDispatch",
  schedule: "actions.event.schedule",
  release: "actions.event.release",
  merge_group: "actions.event.mergeGroup",
  dynamic: "actions.event.dynamic",
};
const WORD_SEPARATOR = /_/g;

export function eventLabel(t: Translate, event: string): string {
  const key = EVENT_LABELS[event];
  return key === undefined ? event.replace(WORD_SEPARATOR, " ") : t(key);
}

export function formatDuration(
  t: Translate,
  startedAt: string | null,
  endedAt: string | null,
  now: number,
): string | null {
  if (startedAt === null) return null;
  const end = endedAt === null ? now : Date.parse(endedAt);
  const seconds = Math.max(0, Math.round((end - Date.parse(startedAt)) / SECOND_MS));
  const hours = Math.floor(seconds / HOUR_S);
  const minutes = Math.floor((seconds % HOUR_S) / MINUTE_S);
  if (hours > 0) return t("actions.duration.hours", { hours, minutes });
  if (minutes > 0) return t("actions.duration.minutes", { minutes, seconds: seconds % MINUTE_S });
  return t("actions.duration.seconds", { seconds });
}
