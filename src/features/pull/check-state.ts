import type { CheckRun, StatusContext } from "@/data/pulls";
import type { MessageKey } from "@/i18n/index.tsx";
import type { Status } from "@/ui/StatusIcon.tsx";

export interface CheckState {
  icon: Status;
  label: MessageKey;
  group: "failing" | "pending" | "passing" | "skipped";
}

const CONCLUSIONS: Readonly<Record<NonNullable<CheckRun["conclusion"]>, CheckState>> = {
  success: { icon: "success", label: "pull.checks.state.success", group: "passing" },
  failure: { icon: "failure", label: "pull.checks.state.failure", group: "failing" },
  timedOut: { icon: "failure", label: "pull.checks.state.timedOut", group: "failing" },
  cancelled: { icon: "closed", label: "pull.checks.state.cancelled", group: "failing" },
  actionRequired: { icon: "pending", label: "pull.checks.state.actionRequired", group: "failing" },
  neutral: { icon: "draft", label: "pull.checks.state.neutral", group: "passing" },
  skipped: { icon: "draft", label: "pull.checks.state.skipped", group: "skipped" },
  stale: { icon: "draft", label: "pull.checks.state.stale", group: "skipped" },
};

const STATUSES: Readonly<Record<StatusContext["state"], CheckState>> = {
  success: { icon: "success", label: "pull.checks.state.success", group: "passing" },
  failure: { icon: "failure", label: "pull.checks.state.failure", group: "failing" },
  error: { icon: "failure", label: "pull.checks.state.error", group: "failing" },
  pending: { icon: "pending", label: "pull.checks.state.pending", group: "pending" },
  expected: { icon: "pending", label: "pull.checks.state.expected", group: "pending" },
};

export function checkRunState(run: Pick<CheckRun, "status" | "conclusion">): CheckState {
  if (run.status !== "completed" || run.conclusion === null) {
    const label =
      run.status === "inProgress" ? "pull.checks.state.inProgress" : "pull.checks.state.queued";
    return { icon: "pending", label, group: "pending" };
  }
  return CONCLUSIONS[run.conclusion];
}

export function statusContextState(state: StatusContext["state"]): CheckState {
  return STATUSES[state];
}

export function countByGroup(states: readonly CheckState[]): Record<CheckState["group"], number> {
  const counts = { failing: 0, pending: 0, passing: 0, skipped: 0 };
  for (const state of states) counts[state.group]++;
  return counts;
}
