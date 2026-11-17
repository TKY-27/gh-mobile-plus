import { useState } from "react";
import { Check, ChevronDown, GitMerge } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import type { MergeMethod } from "@/data/repo";
import { useMergePullRequest, type PullRequestDetail } from "@/data/pulls";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { describeError, ErrorState } from "@/ui/ErrorState.tsx";
import {
  isOrgAccessRestricted,
  showErrorToast,
  showOrgAccessRestrictedToast,
} from "@/ui/error-toast.ts";
import { Menu } from "@/ui/Menu.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { useNow } from "@/ui/RelativeTime.tsx";
import { Sheet } from "@/ui/Sheet.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { TextArea, TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { canMerge, MergeStatus } from "./MergeStatus.tsx";
import styles from "./Pull.module.css";

const METHOD_ORDER: readonly MergeMethod[] = ["merge", "squash", "rebase"];

const METHOD_LABELS: Readonly<Record<MergeMethod, MessageKey>> = {
  merge: "pull.merge.method.merge",
  squash: "pull.merge.method.squash",
  rebase: "pull.merge.method.rebase",
};

/** Remount to reset fields on reopening. */
export function MergeSheet(props: {
  pull: PullRequestDetail;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  const now = useNow();
  const { pull } = props;
  const { merge } = pull;
  const mergePull = useMergePullRequest();
  const [method, setMethod] = useState<MergeMethod>(merge.defaultMethod);
  const [title, setTitle] = useState(merge.defaultTitle[merge.defaultMethod]);
  const [message, setMessage] = useState(merge.defaultMessage[merge.defaultMethod]);
  const [edited, setEdited] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const enabled = canMerge(pull) && (method === "rebase" || title.trim() !== "");

  const chooseMethod = (next: MergeMethod) => {
    setMethod(next);
    if (edited) return;
    setTitle(merge.defaultTitle[next]);
    setMessage(merge.defaultMessage[next]);
  };

  const submit = () => {
    mergePull
      .mutateAsync({
        pullRequestId: pull.id,
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        method,
        title,
        message,
        expectedHeadOid: pull.headOid,
        deleteBranch: deleteBranch && merge.canDeleteHeadBranch,
      })
      .then(
        (result) => {
          props.onOpenChange(false);
          const { branchDeleteError } = result;
          if (!branchDeleteError) {
            showToast(t(result.branchDeleted ? "pull.merge.mergedDeleted" : "pull.merge.merged"));
          } else if (isOrgAccessRestricted(branchDeleteError)) {
            showOrgAccessRestrictedToast(t, branchDeleteError, t("pull.merge.mergedKeptBranch"));
          } else {
            showErrorToast(t, branchDeleteError, t("pull.merge.mergedKeptBranch"));
          }
        },
        (error: unknown) => {
          if (!isOrgAccessRestricted(error)) {
            showErrorToast(t, error, describeError(t, formatters, error, now).message, submit);
          }
        },
      );
  };

  return (
    <Sheet isOpen={props.isOpen} onOpenChange={props.onOpenChange} title={t("pull.merge.title")}>
      <div className={styles.mergeSheet}>
        <MergeStatus pull={pull} />
        {method === "rebase" ? (
          <p className={styles.mergeNote}>{t("pull.merge.rebaseNote")}</p>
        ) : (
          <>
            <TextField
              label={t("pull.merge.commitTitle")}
              value={title}
              onChange={(value) => {
                setEdited(true);
                setTitle(value);
              }}
              isRequired
            />
            <TextArea
              label={t("pull.merge.commitMessage")}
              value={message}
              onChange={(value) => {
                setEdited(true);
                setMessage(value);
              }}
            />
          </>
        )}
        {merge.canDeleteHeadBranch ? (
          <Switch isSelected={deleteBranch} onChange={setDeleteBranch}>
            {t("pull.merge.deleteBranch", { branch: pull.headRef })}
          </Switch>
        ) : null}
        {mergePull.isError ? (
          <ErrorState error={mergePull.error} {...(enabled ? { onRetry: submit } : {})} />
        ) : null}
        <div className={styles.split}>
          <Button
            variant="primary"
            wide
            icon={<GitMerge aria-hidden />}
            isDisabled={!enabled}
            isPending={mergePull.isPending}
            onPress={submit}
          >
            {t(METHOD_LABELS[method])}
          </Button>
          {merge.allowedMethods.length > 1 ? (
            <Menu
              label={t("pull.merge.chooseMethod")}
              actions={METHOD_ORDER.filter((option) => merge.allowedMethods.includes(option)).map(
                (option) => ({
                  id: option,
                  label: t(METHOD_LABELS[option]),
                  ...(option === method ? { icon: <Check aria-hidden /> } : {}),
                  onAction: () => {
                    chooseMethod(option);
                  },
                }),
              )}
            >
              <AriaButton
                className={moduleClass(styles.splitToggle)}
                aria-label={t("pull.merge.chooseMethod")}
                isDisabled={mergePull.isPending}
              >
                <ChevronDown aria-hidden />
              </AriaButton>
            </Menu>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
