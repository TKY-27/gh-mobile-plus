import { UserPlus, Users } from "lucide-react";
import { useAssignableUsers } from "@/data/issues";
import { useRequestReviewers, type PullRequestDetail } from "@/data/pulls";
import type { Actor } from "@/data/types";
import { MultiPickerSheet } from "@/features/issue/PickerSheet.tsx";
import { useSheetSession } from "@/ui/sheet-session.ts";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { Button } from "@/ui/Button.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { StatusIcon, type Status } from "@/ui/StatusIcon.tsx";
import { showToast } from "@/ui/Toast.tsx";
import styles from "./Pull.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

const AVATAR_PX = 28;
const PICKER_AVATAR_PX = 22;

type ReviewState = PullRequestDetail["latestReviews"][number]["state"] | "requested";

const STATES: Readonly<Record<ReviewState, { status: Status; label: MessageKey }>> = {
  approved: { status: "success", label: "pull.reviewers.approved" },
  changesRequested: { status: "failure", label: "pull.reviewers.changesRequested" },
  commented: { status: "draft", label: "pull.reviewers.commented" },
  dismissed: { status: "draft", label: "pull.reviewers.dismissed" },
  requested: { status: "pending", label: "pull.reviewers.awaiting" },
};

function isActor(reviewer: Actor | { team: string }): reviewer is Actor {
  return "login" in reviewer;
}

function RequestSheet(props: {
  pull: PullRequestDetail;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { pull } = props;
  const users = useAssignableUsers(pull.repo.owner, pull.repo.name);
  const request = useRequestReviewers();
  const requested = pull.requestedReviewers.filter(isActor).map((actor) => actor.login);
  const apply = (logins: readonly string[]) => {
    request.mutate(
      {
        pullRequestId: pull.id,
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        logins,
      },
      {
        onSuccess: () => {
          showToast(t("pull.reviewers.requested"));
        },
        onError: (error) => {
          showErrorToast(t, error, t("pull.reviewers.failed"), () => {
            apply(logins);
          });
        },
      },
    );
  };
  return (
    <MultiPickerSheet
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      title={t("pull.reviewers.request")}
      options={users.data
        ?.filter((user) => user.login !== pull.author?.login)
        .map((user) => ({
          id: user.login,
          label: user.login,
          leading: <Avatar src={user.avatarUrl} name={user.login} size={PICKER_AVATAR_PX} />,
        }))}
      isPending={users.isPending}
      error={users.error}
      onRetry={() => void users.refetch()}
      emptyMessage={t("issue.assignees.none")}
      initial={requested}
      disabledKeys={requested}
      {...(requested.length > 0 ? { note: t("pull.reviewers.requestedNote") } : {})}
      onApply={apply}
    />
  );
}

export function Reviewers(props: { pull: PullRequestDetail }) {
  const t = useT();
  const { pull } = props;
  const request = useSheetSession<null>();
  const reviewed = pull.latestReviews.flatMap((review) =>
    review.author ? [{ actor: review.author, state: review.state }] : [],
  );
  const pending = pull.requestedReviewers.filter(
    (reviewer) =>
      !isActor(reviewer) || !reviewed.some((entry) => entry.actor.login === reviewer.login),
  );
  const canRequest = pull.state === "open" && pull.viewerCan.update;

  return (
    <>
      <ListSection
        title={t("pull.reviewers.title")}
        {...(canRequest
          ? {
              footer: (
                <Button
                  variant="plain"
                  icon={<UserPlus aria-hidden />}
                  onPress={() => {
                    request.open(null);
                  }}
                >
                  {t("pull.reviewers.request")}
                </Button>
              ),
            }
          : {})}
      >
        {reviewed.length === 0 && pending.length === 0 ? (
          <ListRow title={t("pull.reviewers.none")} />
        ) : null}
        {[
          ...reviewed,
          ...pending.map((reviewer) => ({ actor: reviewer, state: "requested" as const })),
        ].map(({ actor, state }) => {
          const name = isActor(actor) ? actor.login : actor.team;
          return (
            <ListRow
              key={name}
              leading={
                isActor(actor) ? (
                  <Avatar src={actor.avatarUrl} name={actor.login} size={AVATAR_PX} />
                ) : (
                  <Users aria-hidden />
                )
              }
              title={name}
              detail={
                <span className={styles.reviewState} data-status={STATES[state].status}>
                  <span aria-hidden>
                    <StatusIcon status={STATES[state].status} />
                  </span>
                  {t(STATES[state].label)}
                </span>
              }
            />
          );
        })}
      </ListSection>
      {request.sheet ? (
        <RequestSheet
          key={request.sheet.session}
          pull={pull}
          isOpen={request.sheet.open}
          onOpenChange={request.setOpen}
        />
      ) : null}
    </>
  );
}
