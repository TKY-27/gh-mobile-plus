import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import styles from "./SubjectStatus.module.css";

const ROW_ICON_PX = 20;

export type SubjectState =
  | "issueOpen"
  | "issueCompleted"
  | "issueNotPlanned"
  | "pullOpen"
  | "pullDraft"
  | "pullMerged"
  | "pullClosed";

const STATES = {
  issueOpen: {
    icon: CircleDot,
    tone: "success",
    label: "issue.state.open",
    iconLabel: "issue.state.iconOpen",
  },
  issueCompleted: {
    icon: CircleCheck,
    tone: "merged",
    label: "issue.state.closed",
    iconLabel: "issue.state.iconClosed",
  },
  issueNotPlanned: {
    icon: CircleSlash,
    tone: "draft",
    label: "issue.state.notPlanned",
    iconLabel: "issue.state.iconNotPlanned",
  },
  pullOpen: {
    icon: GitPullRequest,
    tone: "success",
    label: "pull.state.open",
    iconLabel: "pull.state.iconOpen",
  },
  pullDraft: {
    icon: GitPullRequestDraft,
    tone: "draft",
    label: "pull.state.draft",
    iconLabel: "pull.state.iconDraft",
  },
  pullMerged: {
    icon: GitMerge,
    tone: "merged",
    label: "pull.state.merged",
    iconLabel: "pull.state.iconMerged",
  },
  pullClosed: {
    icon: GitPullRequestClosed,
    tone: "closed",
    label: "pull.state.closed",
    iconLabel: "pull.state.iconClosed",
  },
} as const satisfies Record<
  SubjectState,
  { icon: unknown; tone: string; label: MessageKey; iconLabel: MessageKey }
>;

export function pullSubjectState(
  state: "open" | "closed" | "merged",
  isDraft?: boolean,
): SubjectState {
  if (state === "merged") return "pullMerged";
  if (state === "closed") return "pullClosed";
  return isDraft ? "pullDraft" : "pullOpen";
}

export function issueSubjectState(
  state: "open" | "closed",
  reason?: "completed" | "notPlanned" | "reopened" | null,
): SubjectState {
  if (state === "open") return "issueOpen";
  return reason === "notPlanned" ? "issueNotPlanned" : "issueCompleted";
}

export function SubjectStateIcon(props: { state: SubjectState }) {
  const t = useT();
  const { icon: Icon, tone, iconLabel } = STATES[props.state];
  return (
    <Icon
      className={styles.stateIcon}
      data-tone={tone}
      width={ROW_ICON_PX}
      height={ROW_ICON_PX}
      role="img"
      aria-label={t(iconLabel)}
    />
  );
}

export function StatePill(props: { state: SubjectState }) {
  const t = useT();
  const { icon: Icon, tone, label } = STATES[props.state];
  return (
    <span className={styles.statePill} data-tone={tone}>
      <Icon aria-hidden />
      {t(label)}
    </span>
  );
}
