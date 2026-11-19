import { useState } from "react";
import { FileX, GitBranch, History, Trash2 } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { useScreen, useScreenParams } from "@/app/navigation/screen.ts";
import { editRoute } from "@/app/router.ts";
import { useSoftKeyboardOpen } from "@/app/keyboard.ts";
import { useComposerActive } from "@/app/updates.ts";
import type { CommitOutcome } from "@/data/commit";
import { draftKeys, useDraft } from "@/data/drafts";
import { qualifiedRef } from "@/data/links";
import { usePreferences } from "@/data/preferences";
import { useFile, useRepository } from "@/data/repo";
import { useActiveAccount } from "@/data/session";
import { useT } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { Button } from "@/ui/Button.tsx";
import { CodeEditor } from "@/ui/code/CodeEditor.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { CommitSheet } from "./CommitSheet.tsx";
import styles from "./EditScreen.module.css";

interface EditDraft {
  content: string;
  baseOid: string;
}

const NO_DRAFT: EditDraft = { content: "", baseOid: "" };

function outcomePath(outcome: CommitOutcome): string {
  return outcome.kind === "commit"
    ? `/${outcome.owner}/${outcome.repo}/commit/${outcome.oid}`
    : `/${outcome.owner}/${outcome.repo}/pull/${String(outcome.number)}`;
}

export default function EditScreen() {
  const t = useT();
  const router = useRouter();
  const { isTop } = useScreen();
  const { login, publicOnly } = useActiveAccount();
  const { softWrap } = usePreferences();
  const keyboardOpen = useSoftKeyboardOpen();
  const { owner, repo, ref: branch, _splat: path = "" } = useScreenParams(editRoute);
  const file = useFile(owner, repo, qualifiedRef("branches", branch), path);
  const repository = useRepository(owner, repo);
  const [draft, setDraft, clearDraft, draftLoaded] = useDraft<EditDraft>(
    draftKeys.fileEdit(owner, repo, branch, path),
    NO_DRAFT,
  );
  const [editorKey, setEditorKey] = useState(0);
  const [committing, setCommitting] = useState(false);
  const name = path.split("/").at(-1) ?? path;
  const hasDraft = draft.baseOid !== "";
  const [restored, setRestored] = useState<boolean | null>(null);
  if (draftLoaded && restored === null) setRestored(hasDraft);
  useComposerActive(hasDraft);

  const source =
    (file.data?.kind === "text" || file.data?.kind === "markdown") && file.data.onBranch
      ? file.data
      : null;
  const subject = source
    ? {
        owner,
        repo,
        branch,
        path,
        content: hasDraft ? draft.content : source.text,
        baseOid: hasDraft ? draft.baseOid : source.headOid,
      }
    : null;

  const canCommit =
    repository.data?.viewerCanEditFiles && !(publicOnly && repository.data.isPrivate);

  const discard = () => {
    const previous = draft;
    clearDraft();
    setEditorKey((key) => key + 1);
    showToast(t("code.edit.discarded"), {
      action: {
        label: t("common.undo"),
        onAction: () => {
          setDraft(previous);
          setEditorKey((key) => key + 1);
        },
      },
    });
  };

  let body;
  if (file.isPending || !draftLoaded) {
    body = (
      <div className={styles.skeleton} aria-busy="true">
        <Skeleton width="70%" height="1rem" />
        <Skeleton width="90%" height="1rem" />
        <Skeleton width="55%" height="1rem" />
      </div>
    );
  } else if (file.isError) {
    body = (
      <ErrorState
        error={file.error}
        fullScreen={isFullScreenError(file.error)}
        onRetry={() => void file.refetch()}
      />
    );
  } else if (!source || !subject) {
    body = (
      <EmptyState
        icon={<FileX />}
        title={t("code.edit.unsupported")}
        message={t("code.edit.unsupportedMessage")}
      />
    );
  } else {
    body = (
      <>
        {restored && hasDraft ? (
          <Banner icon={<History />}>{t("code.edit.restored")}</Banner>
        ) : null}
        <CodeEditor
          key={editorKey}
          initialValue={subject.content}
          language={source.kind === "text" ? source.language : "markdown"}
          label={t("code.edit.label", { name })}
          softWrap={softWrap}
          keyboardOpen={keyboardOpen}
          onChange={(content) => {
            if (content === source.text && subject.baseOid === source.headOid) clearDraft();
            else setDraft({ content, baseOid: subject.baseOid });
          }}
        />
      </>
    );
  }

  return (
    <Page
      title={name}
      menuActions={
        hasDraft
          ? [
              {
                id: "discard",
                label: t("code.edit.discard"),
                icon: <Trash2 aria-hidden />,
                destructive: true,
                onAction: discard,
              },
            ]
          : []
      }
      actions={
        <Button
          variant="plain"
          isDisabled={!hasDraft || !subject || !canCommit}
          onPress={() => {
            setCommitting(true);
          }}
        >
          {t("code.edit.commit")}
        </Button>
      }
    >
      <p className={styles.branch}>
        <GitBranch aria-hidden />
        {t("code.edit.onBranch", { branch })}
      </p>
      {repository.data && !canCommit ? (
        <p className={styles.branch}>
          {t(
            repository.data.hasPullRequestsEnabled
              ? "code.create.conflict.noPermissionMessage"
              : "code.commit.pullRequestsDisabled",
          )}
        </p>
      ) : null}
      {repository.isError ? (
        <ErrorState error={repository.error} onRetry={() => void repository.refetch()} />
      ) : null}
      {body}
      {subject && repository.data && canCommit ? (
        <CommitSheet
          isOpen={isTop && committing}
          onOpenChange={setCommitting}
          subject={subject}
          canPush={repository.data.viewerCanPush}
          canProposePull={repository.data.hasPullRequestsEnabled}
          login={login}
          onCommitted={(outcome, openResult) => {
            clearDraft();
            setCommitting(false);
            if (openResult) router.history.replace(outcomePath(outcome));
            else setEditorKey((key) => key + 1);
          }}
        />
      ) : null}
    </Page>
  );
}
