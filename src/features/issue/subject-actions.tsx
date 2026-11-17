import { Bell, BellOff, CircleCheck, CircleDot, CircleSlash, Lock, LockOpen } from "lucide-react";
import { useSetIssueState, useSetLocked, useSetSubscribed, type IssueDetail } from "@/data/issues";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import type { MenuAction } from "@/ui/Menu.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { showErrorToast } from "@/ui/error-toast.ts";

export interface ActionSubject extends Pick<
  IssueDetail,
  "id" | "repo" | "number" | "locked" | "viewerSubscribed" | "viewerCan"
> {
  kind: "issue" | "pullRequest";
  state: "open" | "closed" | "merged";
  closedReason: "completed" | "notPlanned";
}

type StateChange = { state: "open" } | { state: "closed"; reason: "completed" | "notPlanned" };

const CHANGE_MESSAGES: Record<string, MessageKey> = {
  "issue:open": "issue.actions.reopened",
  "issue:completed": "issue.actions.closedCompleted",
  "issue:notPlanned": "issue.actions.closedNotPlanned",
  "pullRequest:open": "pull.actions.reopened",
  "pullRequest:completed": "pull.actions.closed",
  "pullRequest:notPlanned": "pull.actions.closed",
};

export function useSubjectActions(subject: ActionSubject): MenuAction[] {
  const t = useT();
  const setState = useSetIssueState();
  const setLocked = useSetLocked();
  const setSubscribed = useSetSubscribed();
  const target = {
    subjectId: subject.id,
    owner: subject.repo.owner,
    repo: subject.repo.name,
    number: subject.number,
  };

  const retryToast = (message: MessageKey, retry: () => void) => ({
    onError: (error: unknown) => {
      showErrorToast(t, error, t(message), retry);
    },
  });

  const changeState = (change: StateChange, undo: StateChange | null) => {
    const reason = change.state === "closed" ? change.reason : undefined;
    setState.mutate(
      { ...target, ...change },
      retryToast("issue.actions.stateFailed", () => {
        changeState(change, undo);
      }),
    );
    const message = CHANGE_MESSAGES[`${subject.kind}:${reason ?? "open"}`];
    if (message === undefined || undo === null) return;
    showToast(t(message), {
      action: {
        label: t("common.undo"),
        onAction: () => {
          changeState(undo, null);
        },
      },
    });
  };

  const toggleLock = () => {
    const locked = !subject.locked;
    setLocked.mutate(
      { subjectId: subject.id, locked },
      retryToast("issue.actions.lockFailed", toggleLock),
    );
  };

  const toggleSubscription = () => {
    const subscribed = !subject.viewerSubscribed;
    setSubscribed.mutate(
      { subjectId: subject.id, subscribed },
      retryToast("issue.actions.subscriptionFailed", toggleSubscription),
    );
    showToast(t(subscribed ? "issue.actions.subscribed" : "issue.actions.unsubscribed"));
  };

  const actions: MenuAction[] = [];
  const reopen: StateChange = { state: "open" };
  if (subject.viewerCan.close && subject.state === "open" && subject.kind === "issue") {
    actions.push(
      {
        id: "close-completed",
        label: t("issue.actions.closeCompleted"),
        icon: <CircleCheck aria-hidden />,
        onAction: () => {
          changeState({ state: "closed", reason: "completed" }, reopen);
        },
      },
      {
        id: "close-not-planned",
        label: t("issue.actions.closeNotPlanned"),
        icon: <CircleSlash aria-hidden />,
        onAction: () => {
          changeState({ state: "closed", reason: "notPlanned" }, reopen);
        },
      },
    );
  }
  if (subject.viewerCan.close && subject.state === "open" && subject.kind === "pullRequest") {
    actions.push({
      id: "close",
      label: t("pull.actions.close"),
      icon: <CircleSlash aria-hidden />,
      destructive: true,
      onAction: () => {
        changeState({ state: "closed", reason: "completed" }, reopen);
      },
    });
  }
  if (subject.viewerCan.close && subject.state === "closed") {
    actions.push({
      id: "reopen",
      label: t(subject.kind === "issue" ? "issue.actions.reopen" : "pull.actions.reopen"),
      icon: <CircleDot aria-hidden />,
      onAction: () => {
        changeState(reopen, { state: "closed", reason: subject.closedReason });
      },
    });
  }
  if (subject.viewerCan.lock) {
    actions.push({
      id: "lock",
      label: t(subject.locked ? "issue.actions.unlock" : "issue.actions.lock"),
      icon: subject.locked ? <LockOpen aria-hidden /> : <Lock aria-hidden />,
      onAction: toggleLock,
    });
  }
  actions.push({
    id: "subscription",
    label: t(subject.viewerSubscribed ? "issue.actions.unsubscribe" : "issue.actions.subscribe"),
    icon: subject.viewerSubscribed ? <BellOff aria-hidden /> : <Bell aria-hidden />,
    onAction: toggleSubscription,
  });
  return actions;
}
