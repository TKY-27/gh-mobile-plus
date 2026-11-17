import { GitBranch } from "lucide-react";
import { Link } from "react-aria-components/Link";
import type { WorkflowRun } from "@/data/actions";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime, useNow } from "@/ui/RelativeTime.tsx";
import { StatusIcon } from "@/ui/StatusIcon.tsx";
import { eventLabel, formatDuration, runState } from "./run-status.ts";
import styles from "./Actions.module.css";

export const RUN_ROW_ESTIMATE_PX = 104;
const ACTOR_AVATAR_PX = 16;
const STATUS_ICON_PX = 20;

export function RunByline(props: { run: WorkflowRun }) {
  const { actor } = props.run;
  return (
    <>
      {actor ? (
        <span className={styles.actor}>
          <Avatar src={actor.avatarUrl} name={actor.login} size={ACTOR_AVATAR_PX} />
          {actor.login}
        </span>
      ) : null}
      <RelativeTime date={props.run.createdAt} />
    </>
  );
}

export function RunRow(props: { owner: string; repo: string; run: WorkflowRun }) {
  const t = useT();
  const now = useNow();
  const { run } = props;
  const state = runState(run.status, run.conclusion);
  const ended = run.status === "completed" ? run.updatedAt : null;
  const duration = formatDuration(t, run.runStartedAt, ended, now);
  return (
    <Link
      href={`/${props.owner}/${props.repo}/actions/runs/${String(run.id)}`}
      className={moduleClass(styles.run)}
    >
      <StatusIcon status={state.icon} size={STATUS_ICON_PX} />
      <span className={styles.runText}>
        <span className={styles.runTitle}>{run.displayTitle}</span>
        <span className={styles.runMeta}>
          {t("actions.run.number", { workflow: run.name, number: run.runNumber })} ·{" "}
          {eventLabel(t, run.event)}
        </span>
        <span className={styles.runMeta}>
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
        </span>
        <span className={styles.runMeta}>
          <RunByline run={run} />
        </span>
      </span>
    </Link>
  );
}
