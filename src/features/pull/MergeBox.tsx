import { GitMerge, GitPullRequestArrow, RefreshCw } from "lucide-react";
import { useUpdateBranch, type PullRequestDetail } from "@/data/pulls";
import { useSheetSession } from "@/ui/sheet-session.ts";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { StatusIcon, type Status } from "@/ui/StatusIcon.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { MergeSheet } from "./MergeSheet.tsx";
import { MergeStatus } from "./MergeStatus.tsx";
import { pullPath, useDraftToggle } from "./PullPage.tsx";
import styles from "./Pull.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const ROW_ICON_PX = 20;

const CHECKS: Readonly<
  Record<"success" | "failure" | "pending", { status: Status; label: MessageKey }>
> = {
  success: { status: "success", label: "pull.checks.allPassed" },
  failure: { status: "failure", label: "pull.checks.someFailed" },
  pending: { status: "pending", label: "pull.checks.running" },
};

const REVIEWS: Readonly<
  Record<"approved" | "changesRequested" | "reviewRequired", { status: Status; label: MessageKey }>
> = {
  approved: { status: "success", label: "pull.review.approved" },
  changesRequested: { status: "failure", label: "pull.review.changesRequested" },
  reviewRequired: { status: "pending", label: "pull.review.required" },
};

function UpdateBranchButton(props: { pull: PullRequestDetail }) {
  const t = useT();
  const update = useUpdateBranch();
  const { pull } = props;
  const run = () => {
    update.mutate(
      {
        pullRequestId: pull.id,
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        expectedHeadOid: pull.headOid,
      },
      {
        onSuccess: () => {
          showToast(t("pull.updateBranch.done"));
        },
        onError: (error) => {
          showErrorToast(t, error, t("pull.updateBranch.failed"), run);
        },
      },
    );
  };
  return (
    <Button icon={<RefreshCw aria-hidden />} isPending={update.isPending} onPress={run}>
      {t("pull.updateBranch.action")}
    </Button>
  );
}

export function MergeBox(props: { pull: PullRequestDetail }) {
  const t = useT();
  const { pull } = props;
  const draft = useDraftToggle(pull);
  const merge = useSheetSession<null>();
  if (pull.state !== "open") return null;
  const checks = pull.checks === null ? null : CHECKS[pull.checks];
  const review = pull.reviewDecision === null ? null : REVIEWS[pull.reviewDecision];
  const behind = pull.merge.state === "behind" && pull.viewerCan.updateBranch;

  return (
    <>
      <ListSection title={t("pull.mergeStatus.title")}>
        {checks ? (
          <ListRow
            leading={
              <span aria-hidden>
                <StatusIcon status={checks.status} size={ROW_ICON_PX} />
              </span>
            }
            title={t(checks.label)}
            href={pullPath(pull, "checks")}
          />
        ) : null}
        {review ? (
          <ListRow
            leading={
              <span aria-hidden>
                <StatusIcon status={review.status} size={ROW_ICON_PX} />
              </span>
            }
            title={t(review.label)}
          />
        ) : null}
        <li className={styles.mergeItem}>
          <MergeStatus pull={pull} />
          <div className={styles.mergeActions}>
            {pull.isDraft && pull.viewerCan.markReady ? (
              <Button
                variant="primary"
                icon={<GitPullRequestArrow aria-hidden />}
                isPending={draft.isPending}
                onPress={() => {
                  draft.toggle(false);
                }}
              >
                {t("pull.draft.markReady")}
              </Button>
            ) : null}
            {!pull.isDraft && pull.merge.viewerCanMerge ? (
              <Button
                variant="primary"
                icon={<GitMerge aria-hidden />}
                onPress={() => {
                  merge.open(null);
                }}
              >
                {t("pull.merge.open")}
              </Button>
            ) : null}
            {behind ? <UpdateBranchButton pull={pull} /> : null}
          </div>
        </li>
      </ListSection>
      {merge.sheet ? (
        <MergeSheet
          key={merge.sheet.session}
          pull={pull}
          isOpen={merge.sheet.open}
          onOpenChange={merge.setOpen}
        />
      ) : null}
    </>
  );
}
