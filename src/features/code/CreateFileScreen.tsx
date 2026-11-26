import { useRef, useState } from "react";
import { FileWarning, FolderX, GitBranch, History, Lock, Trash2, WifiOff } from "lucide-react";
import { Form } from "react-aria-components/Form";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { useSoftKeyboardOpen } from "@/app/keyboard.ts";
import { useIsTopScreen, useScreenParams } from "@/app/navigation/screen.ts";
import { newFileRoute } from "@/app/router.ts";
import { useComposerActive } from "@/app/updates.ts";
import {
  isContentWithinLimit,
  newFileDraftKey,
  normalizeDirectory,
  useCreateFileContext,
  validateNewFilePath,
  type CommitOutcome,
  type CreateFileIneligibleReason,
  type FilePathError,
} from "@/data/commit";
import { useDraft } from "@/data/drafts";
import { refKind, refName } from "@/data/links";
import { usePreferences } from "@/data/preferences";
import { languageForPath } from "@/data/repo";
import { useActiveAccount } from "@/data/session";
import { useIsOffline } from "@/data/status";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { Button } from "@/ui/Button.tsx";
import { CodeEditor } from "@/ui/code/CodeEditor.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { CommitSheet } from "./CommitSheet.tsx";
import styles from "./CreateFileScreen.module.css";

interface CreateFileDraft {
  relativePath: string;
  content: string;
}

const NO_DRAFT: CreateFileDraft = { relativePath: "", content: "" };

const PATH_ERRORS: Readonly<Record<FilePathError, MessageKey>> = {
  empty: "code.create.validation.empty",
  emptySegment: "code.create.validation.emptySegment",
  dotSegment: "code.create.validation.dotSegment",
  reservedGit: "code.create.validation.reservedGit",
  invalidCharacters: "code.create.validation.invalidCharacters",
  tooLong: "code.create.validation.tooLong",
};

const INELIGIBLE_COPY: Readonly<
  Record<CreateFileIneligibleReason, { title: MessageKey; message: MessageKey }>
> = {
  notBranch: {
    title: "code.create.ineligible.notBranch.title",
    message: "code.create.ineligible.notBranch.message",
  },
  archived: {
    title: "code.create.ineligible.archived.title",
    message: "code.create.ineligible.archived.message",
  },
  readOnly: {
    title: "code.create.ineligible.readOnly.title",
    message: "code.create.ineligible.readOnly.message",
  },
  emptyRepository: {
    title: "code.create.ineligible.emptyRepository.title",
    message: "code.create.ineligible.emptyRepository.message",
  },
  noPermission: {
    title: "code.create.ineligible.noPermission.title",
    message: "code.create.ineligible.noPermission.message",
  },
  notDirectory: {
    title: "code.create.ineligible.notDirectory.title",
    message: "code.create.ineligible.notDirectory.message",
  },
};

function outcomePath(outcome: CommitOutcome): string {
  return outcome.kind === "commit"
    ? `/${outcome.owner}/${outcome.repo}/commit/${outcome.oid}`
    : `/${outcome.owner}/${outcome.repo}/pull/${String(outcome.number)}`;
}

function ineligibleIcon(reason: CreateFileIneligibleReason) {
  switch (reason) {
    case "notBranch":
      return <GitBranch />;
    case "notDirectory":
      return <FolderX />;
    case "emptyRepository":
      return <FileWarning />;
    case "archived":
    case "readOnly":
    case "noPermission":
      return <Lock />;
  }
}

export default function CreateFileScreen() {
  const t = useT();
  const router = useRouter();
  const isTop = useIsTopScreen();
  const { login } = useActiveAccount();
  const { softWrap } = usePreferences();
  const keyboardOpen = useSoftKeyboardOpen();
  const offline = useIsOffline();
  const { owner, repo, ref: urlRef, _splat: rawDirectory = "" } = useScreenParams(newFileRoute);
  const directory = normalizeDirectory(rawDirectory);
  const branchParam = refKind(urlRef) === "branches" ? refName(urlRef) : urlRef;
  const context = useCreateFileContext(owner, repo, urlRef, directory);
  const [draft, setDraft, clearDraft, draftLoaded] = useDraft<CreateFileDraft>(
    newFileDraftKey(owner, repo, branchParam, directory),
    NO_DRAFT,
  );
  const [editorKey, setEditorKey] = useState(0);
  const [committing, setCommitting] = useState(false);
  const [pathTouched, setPathTouched] = useState(false);
  const [showPathError, setShowPathError] = useState(false);
  const pathFieldRef = useRef<HTMLFormElement | null>(null);
  const hasDraft = draft.relativePath !== "" || draft.content !== "";
  const [restored, setRestored] = useState<boolean | null>(null);
  if (draftLoaded && restored === null) setRestored(hasDraft);
  useComposerActive(hasDraft);

  const eligibleContext = context.data?.eligible ? context.data : null;
  const validated = validateNewFilePath(directory, draft.relativePath);
  const contentTooLarge = !isContentWithinLimit(draft.content);
  const pathErrorMessage = showPathError && !validated.ok ? t(PATH_ERRORS[validated.error]) : null;

  const updateDraft = (next: CreateFileDraft) => {
    if (next.relativePath === "" && next.content === "") clearDraft();
    else setDraft(next);
  };

  const focusPathInput = () => {
    pathFieldRef.current?.querySelector("input")?.focus();
  };

  const openCommit = () => {
    if (!eligibleContext || !draftLoaded) return;
    if (!validated.ok) {
      setShowPathError(true);
      focusPathInput();
      return;
    }
    if (contentTooLarge) return;
    setCommitting(true);
  };

  const discard = () => {
    const previous = draft;
    clearDraft();
    setPathTouched(false);
    setShowPathError(false);
    setEditorKey((key) => key + 1);
    showToast(t("code.create.discarded"), {
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
  if (context.isPending || !draftLoaded) {
    body = (
      <div className={styles.skeleton} aria-busy="true">
        <Skeleton width="70%" height="1rem" />
        <Skeleton width="90%" height="2.75rem" />
        <Skeleton width="65%" height="1rem" />
      </div>
    );
  } else if (context.isError) {
    body = (
      <ErrorState
        error={context.error}
        fullScreen={isFullScreenError(context.error)}
        onRetry={() => void context.refetch()}
      />
    );
  } else if (!context.data.eligible) {
    const reason = context.data.reason;
    const copy = INELIGIBLE_COPY[reason];
    body = (
      <EmptyState icon={ineligibleIcon(reason)} title={t(copy.title)} message={t(copy.message)} />
    );
  } else {
    const targetContext = context.data;
    body = (
      <>
        <p className={styles.branch}>
          <GitBranch aria-hidden />
          {t("code.create.onBranch", { branch: targetContext.branch })}
        </p>
        {restored && hasDraft ? (
          <Banner icon={<History />}>{t("code.create.restored")}</Banner>
        ) : null}
        {offline ? <Banner icon={<WifiOff />}>{t("code.create.offline")}</Banner> : null}
        <Form
          ref={pathFieldRef}
          className={moduleClass(styles.pathField)}
          validationErrors={pathErrorMessage ? { path: pathErrorMessage } : {}}
          onSubmit={(event) => {
            event.preventDefault();
            openCommit();
          }}
        >
          <TextField
            name="path"
            label={t("code.create.pathLabel")}
            placeholder={t("code.create.pathPlaceholder")}
            description={
              directory
                ? t("code.create.pathInDirectory", { directory })
                : t("code.create.pathHint")
            }
            value={draft.relativePath}
            onChange={(relativePath) => {
              setPathTouched(true);
              setShowPathError(false);
              updateDraft({ relativePath, content: draft.content });
            }}
            onBlur={() => {
              if (pathTouched) setShowPathError(true);
            }}
            isRequired
            validationBehavior="aria"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Form>
        {contentTooLarge ? (
          <p role="alert" className={styles.contentError}>
            {t("code.create.validation.tooLarge")}
          </p>
        ) : null}
        <CodeEditor
          key={editorKey}
          initialValue={draft.content}
          language={validated.ok ? languageForPath(validated.path) : null}
          label={t("code.create.editorLabel")}
          softWrap={softWrap}
          keyboardOpen={keyboardOpen}
          onChange={(content) => {
            updateDraft({ relativePath: draft.relativePath, content });
          }}
        />
      </>
    );
  }

  return (
    <Page
      title={t("code.create.title")}
      menuActions={
        eligibleContext && hasDraft
          ? [
              {
                id: "discard",
                label: t("code.create.discard"),
                icon: <Trash2 aria-hidden />,
                destructive: true,
                onAction: discard,
              },
            ]
          : []
      }
      actions={
        <Button variant="plain" isDisabled={!eligibleContext || !draftLoaded} onPress={openCommit}>
          {t("code.edit.commit")}
        </Button>
      }
    >
      {body}
      {eligibleContext && validated.ok && !contentTooLarge ? (
        <CommitSheet
          mode="create"
          isOpen={isTop && committing}
          onOpenChange={setCommitting}
          subject={{
            owner,
            repo,
            branch: eligibleContext.branch,
            path: validated.path,
            content: draft.content,
            baseOid: eligibleContext.headOid,
          }}
          canPush={eligibleContext.canPush}
          canProposePull={eligibleContext.canProposePull}
          login={login}
          onChangePath={() => {
            setCommitting(false);
            requestAnimationFrame(focusPathInput);
          }}
          onCommitted={(outcome, openResult) => {
            clearDraft();
            setPathTouched(false);
            setShowPathError(false);
            setCommitting(false);
            if (openResult) router.history.replace(outcomePath(outcome));
            else setEditorKey((key) => key + 1);
          }}
        />
      ) : null}
    </Page>
  );
}
