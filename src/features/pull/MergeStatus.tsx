import type { MergeBlockedReason, PullRequestDetail } from "@/data/pulls";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { StatusIcon, type Status } from "@/ui/StatusIcon.tsx";
import styles from "./Pull.module.css";

const STATUS_ICON_PX = 18;

const REASONS: Readonly<Record<MergeBlockedReason, { status: Status; label: MessageKey }>> = {
  reviewRequired: { status: "pending", label: "pull.blocked.reviewRequired" },
  changesRequested: { status: "failure", label: "pull.blocked.changesRequested" },
  checksFailing: { status: "failure", label: "pull.blocked.checksFailing" },
  checksPending: { status: "pending", label: "pull.blocked.checksPending" },
  conflicts: { status: "failure", label: "pull.blocked.conflicts" },
  behind: { status: "pending", label: "pull.blocked.behind" },
  draft: { status: "draft", label: "pull.blocked.draft" },
  blockedByRule: { status: "failure", label: "pull.blocked.blockedByRule" },
};

export function canMerge(pull: Pick<PullRequestDetail, "state" | "merge">): boolean {
  const { merge } = pull;
  return (
    pull.state === "open" &&
    merge.viewerCanMerge &&
    merge.blockedReasons.length === 0 &&
    merge.mergeable === "mergeable"
  );
}

function headline(pull: PullRequestDetail): { status: Status; label: MessageKey } {
  const { merge } = pull;
  if (merge.blockedReasons.length > 0 || merge.mergeable === "conflicting") {
    return { status: "failure", label: "pull.mergeStatus.blocked" };
  }
  if (merge.mergeable === "unknown")
    return { status: "pending", label: "pull.mergeStatus.checking" };
  if (merge.state === "unstable") return { status: "success", label: "pull.mergeStatus.unstable" };
  return { status: "success", label: "pull.mergeStatus.ready" };
}

export function MergeStatus(props: { pull: PullRequestDetail }) {
  const t = useT();
  const { pull } = props;
  const summary = headline(pull);
  const reasons = pull.merge.blockedReasons;
  return (
    <div className={styles.mergeStatus}>
      <p className={styles.mergeHeadline}>
        <span aria-hidden>
          <StatusIcon status={summary.status} size={STATUS_ICON_PX} />
        </span>
        {t(summary.label)}
      </p>
      {reasons.length > 0 ? (
        <ul className={styles.reasons} aria-label={t("pull.mergeStatus.reasons")}>
          {reasons.map((reason) => (
            <li key={reason} className={styles.reason}>
              <span aria-hidden>
                <StatusIcon status={REASONS[reason].status} />
              </span>
              {t(REASONS[reason].label)}
            </li>
          ))}
        </ul>
      ) : null}
      {pull.merge.viewerCanMerge ? null : (
        <p className={styles.mergeNote}>{t("pull.mergeStatus.noPermission")}</p>
      )}
    </div>
  );
}
