import { CircleCheck, CircleDashed, CircleSlash, CircleX, Clock, GitMerge } from "lucide-react";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import styles from "./StatusIcon.module.css";

const DEFAULT_SIZE_PX = 16;

export type Status = "success" | "failure" | "pending" | "merged" | "closed" | "draft";

const ICONS = {
  success: CircleCheck,
  failure: CircleX,
  pending: Clock,
  merged: GitMerge,
  closed: CircleSlash,
  draft: CircleDashed,
} as const;

const LABELS: Record<Status, MessageKey> = {
  success: "common.status.success",
  failure: "common.status.failure",
  pending: "common.status.pending",
  merged: "common.status.merged",
  closed: "common.status.closed",
  draft: "common.status.draft",
};

export function StatusIcon(props: { status: Status; size?: number }) {
  const t = useT();
  const Icon = ICONS[props.status];
  return (
    <Icon
      className={styles.icon}
      data-status={props.status}
      width={props.size ?? DEFAULT_SIZE_PX}
      height={props.size ?? DEFAULT_SIZE_PX}
      role="img"
      aria-label={t(LABELS[props.status])}
    />
  );
}
