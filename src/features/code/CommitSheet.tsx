import { useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  Circle,
  GitBranch,
  GitPullRequest,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { Label } from "react-aria-components/Label";
import { RadioButton, RadioField, RadioGroup } from "react-aria-components/RadioGroup";
import {
  createFileFailure,
  defaultBranchName,
  useCommitFileEdit,
  useCreateFile,
  type CommitOutcome,
  type CommitTarget,
  type CreateFileStep,
} from "@/data/commit";
import type { GitHubError } from "@/data/errors";
import { useIsOffline } from "@/data/status";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { isOrgAccessRestricted, showErrorToast } from "@/ui/error-toast.ts";
import { describeError, ErrorState } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Sheet } from "@/ui/Sheet.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { TextArea, TextField } from "@/ui/TextField.tsx";
import { showToast } from "@/ui/Toast.tsx";
import { isValidBranchName } from "./branch-name.ts";
import { LatestDiff } from "./LatestDiff.tsx";
import styles from "./CommitSheet.module.css";

type Mode = CommitTarget["kind"];
type Problem =
  | { kind: "conflict"; path: string }
  | { kind: "protected"; path: string }
  | { kind: "pathExists"; path: string; detail: string }
  | { kind: "ancestorConflict"; path: string; detail: string }
  | { kind: "headMoved"; path: string }
  | { kind: "readOnly"; path: string }
  | { kind: "noPermission"; path: string };

const STEPS: Readonly<Record<Mode, readonly CreateFileStep[]>> = {
  direct: ["committing"],
  newBranch: ["creatingBranch", "committing", "openingPullRequest"],
  fork: ["forking", "waitingForFork", "creatingBranch", "committing", "openingPullRequest"],
};

const STEP_LABELS: Readonly<Record<CreateFileStep, MessageKey>> = {
  checkingPath: "code.commit.step.checkingPath",
  forking: "code.commit.step.forking",
  waitingForFork: "code.commit.step.waitingForFork",
  creatingBranch: "code.commit.step.creatingBranch",
  committing: "code.commit.step.committing",
  openingPullRequest: "code.commit.step.openingPullRequest",
};

export interface EditSubject {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  baseOid: string;
}

function Progress(props: { mode: Mode; step: CreateFileStep; isCreate: boolean }) {
  const t = useT();
  const steps: readonly CreateFileStep[] = props.isCreate
    ? ["checkingPath", ...STEPS[props.mode]]
    : STEPS[props.mode];
  const current = steps.indexOf(props.step);
  return (
    <ol className={styles.steps} aria-label={t("code.commit.progress")}>
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={step} className={styles.step} data-state={state}>
            {state === "done" ? (
              <Check aria-hidden />
            ) : state === "current" ? (
              // Visible text already announces the step.
              <span aria-hidden>
                <Spinner size="small" />
              </span>
            ) : (
              <Circle aria-hidden />
            )}
            <span aria-current={state === "current" ? "step" : undefined}>
              {t(STEP_LABELS[step])}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ProblemNotice(props: {
  problem: Problem;
  branch: string;
  onViewLatest: () => void;
  onNewBranch?: (() => void) | undefined;
  onRetryDirect: () => void;
  onChangePath?: (() => void) | undefined;
}) {
  const t = useT();
  const { problem, branch } = props;
  const isShield =
    problem.kind === "protected" || problem.kind === "readOnly" || problem.kind === "noPermission";
  let title: string;
  let message: string;
  switch (problem.kind) {
    case "conflict":
      title = t("code.conflict.title");
      message = t("code.conflict.message", { branch });
      break;
    case "protected":
      title = t("code.protected.title");
      message = props.onNewBranch
        ? t("code.protected.message", { branch })
        : t("code.commit.pullRequestsDisabled");
      break;
    case "pathExists":
      title = t("code.create.conflict.existsTitle");
      message = t("code.create.conflict.existsMessage", { path: problem.detail, branch });
      break;
    case "ancestorConflict":
      title = t("code.create.conflict.ancestorTitle");
      message = t("code.create.conflict.ancestorMessage", { path: problem.detail, branch });
      break;
    case "headMoved":
      title = t("code.create.conflict.headMovedTitle");
      message = t("code.create.conflict.headMovedMessage", { branch });
      break;
    case "readOnly":
      title = t("code.create.conflict.readOnlyTitle");
      message = t("code.create.conflict.readOnlyMessage");
      break;
    case "noPermission":
      title = t("code.create.conflict.noPermissionTitle");
      message = t("code.create.conflict.noPermissionMessage");
      break;
  }
  const canChangePath =
    (problem.kind === "pathExists" || problem.kind === "ancestorConflict") &&
    props.onChangePath !== undefined;
  const canBranchInstead =
    props.onNewBranch &&
    (problem.kind === "conflict" || problem.kind === "protected" || problem.kind === "headMoved");

  return (
    <div role="alert" className={styles.problem}>
      {isShield ? <ShieldAlert aria-hidden /> : <TriangleAlert aria-hidden />}
      <div className={styles.problemText}>
        <h3>{title}</h3>
        <p>{message}</p>
        {problem.kind === "conflict" ||
        problem.kind === "headMoved" ||
        canChangePath ||
        canBranchInstead ? (
          <div className={styles.problemActions}>
            {problem.kind === "conflict" ? (
              <Button variant="secondary" onPress={props.onViewLatest}>
                {t("code.conflict.viewLatest")}
              </Button>
            ) : null}
            {problem.kind === "headMoved" ? (
              <Button
                variant="secondary"
                icon={<RotateCcw aria-hidden />}
                onPress={props.onRetryDirect}
              >
                {t("code.create.tryAgain")}
              </Button>
            ) : null}
            {canChangePath && props.onChangePath ? (
              <Button variant="primary" onPress={props.onChangePath}>
                {t("code.create.changePath")}
              </Button>
            ) : null}
            {canBranchInstead ? (
              <Button
                variant="primary"
                icon={<GitBranch aria-hidden />}
                onPress={() => props.onNewBranch?.()}
              >
                {t("code.commit.newBranchInstead")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Stay mounted to receive commit results.
export function CommitSheet(props: {
  mode?: "edit" | "create";
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  subject: EditSubject;
  canPush: boolean;
  canProposePull: boolean;
  login: string;
  onChangePath?: () => void;
  onCommitted: (outcome: CommitOutcome, openResult: boolean) => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  const offline = useIsOffline();
  const isCreate = props.mode === "create";
  const { subject } = props;
  const fileName = subject.path.split("/").at(-1) ?? subject.path;
  const [step, setStep] = useState<CreateFileStep | null>(null);
  const editCommit = useCommitFileEdit(setStep);
  const createCommit = useCreateFile(setStep);
  const activeMutation = isCreate ? createCommit : editCommit;
  const submittedDraft = useRef<EditSubject | null>(null);
  const opening = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    submittedDraft.current = null;
  }, [subject.owner, subject.repo, subject.branch, subject.path, subject.content]);
  useLayoutEffect(() => {
    opening.current = props.isOpen ? Symbol() : null;
    return () => {
      opening.current = null;
    };
  }, [props.isOpen]);
  const [view, setView] = useState<"form" | "latest">("form");
  const [branchMode, setBranchMode] = useState<"direct" | "newBranch">("newBranch");
  const mode: Mode = props.canProposePull ? (props.canPush ? branchMode : "fork") : "direct";
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [branchDate] = useState(() => new Date());
  const [customBranchName, setCustomBranchName] = useState<string | null>(null);
  const branchName = customBranchName ?? defaultBranchName(props.login, subject.path, branchDate);
  const [problem, setProblem] = useState<Problem | null>(null);
  const activeProblem = problem?.path === subject.path ? problem : null;
  const defaultMessage = t(isCreate ? "code.create.defaultMessage" : "code.commit.defaultMessage", {
    name: fileName,
  });
  const message = headline.trim() || defaultMessage;
  const branchValid = mode === "direct" || isValidBranchName(branchName);

  const submit = (target: Mode) => {
    const submittedOpening = opening.current;
    if (
      offline ||
      !submittedOpening ||
      (target === "direct" ? !props.canPush : !props.canProposePull)
    )
      return;
    submittedDraft.current = subject;
    const inSameSheet = () =>
      submittedDraft.current === subject && opening.current === submittedOpening;
    setProblem(null);
    setStep(null);
    const pullRequest = { title: message, body: description };
    const commitTarget: CommitTarget =
      target === "direct" ? { kind: "direct" } : { kind: target, branchName, pullRequest };
    const callbacks = {
      onSuccess: (outcome: CommitOutcome) => {
        showToast(
          t(
            outcome.kind === "pullRequest"
              ? "code.commit.pullRequestOpened"
              : isCreate
                ? "code.create.done"
                : "code.commit.done",
          ),
        );
        if (submittedDraft.current === subject) {
          props.onCommitted(outcome, inSameSheet());
        }
      },
      onError: (error: GitHubError) => {
        if (!inSameSheet()) {
          showErrorToast(t, error, describeError(t, formatters, error, Date.now()).title);
          return;
        }
        if (isCreate) {
          const failure = createFileFailure(error);
          if (failure?.reason === "pathExists") {
            setProblem({ kind: "pathExists", path: subject.path, detail: failure.path });
            return;
          }
          if (failure?.reason === "ancestorConflict") {
            setProblem({ kind: "ancestorConflict", path: subject.path, detail: failure.path });
            return;
          }
          if (failure?.reason === "readOnly") {
            setProblem({ kind: "readOnly", path: subject.path });
            return;
          }
          if (failure?.reason === "noPermission") {
            setProblem({ kind: "noPermission", path: subject.path });
            return;
          }
          if (target === "direct" && error.kind === "conflict") {
            setProblem({ kind: "headMoved", path: subject.path });
            return;
          }
        }
        if (!isCreate && target === "direct" && error.kind === "conflict") {
          setProblem({ kind: "conflict", path: subject.path });
        } else if (target === "direct" && error.kind === "forbidden") {
          setProblem({ kind: "protected", path: subject.path });
        } else if (!isOrgAccessRestricted(error)) {
          const text = describeError(t, formatters, error, Date.now());
          showErrorToast(t, error, text.title, () => {
            if (inSameSheet()) submit(target);
          });
        }
      },
    };
    if (isCreate) {
      createCommit.mutate(
        {
          owner: subject.owner,
          repo: subject.repo,
          branch: subject.branch,
          path: subject.path,
          content: subject.content,
          message: { headline: message, body: description },
          target: commitTarget,
        },
        callbacks,
      );
      return;
    }
    editCommit.mutate(
      {
        owner: subject.owner,
        repo: subject.repo,
        branch: subject.branch,
        path: subject.path,
        content: subject.content,
        expectedHeadOid: subject.baseOid,
        message: { headline: message, body: description },
        target: commitTarget,
      },
      callbacks,
    );
  };

  const commitToNewBranch = () => {
    const fallback = props.canPush ? "newBranch" : "fork";
    setBranchMode("newBranch");
    setView("form");
    submit(fallback);
  };

  const pending = activeMutation.isPending;
  return (
    <Sheet
      isOpen={props.isOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) setView("form");
        props.onOpenChange(isOpen);
      }}
      title={t(
        view === "latest"
          ? "code.conflict.latestTitle"
          : isCreate
            ? "code.create.commitTitle"
            : "code.commit.title",
      )}
    >
      {view === "latest" ? (
        <div className={styles.latest}>
          <LatestDiff
            owner={subject.owner}
            repo={subject.repo}
            branch={subject.branch}
            path={subject.path}
            content={subject.content}
          />
          <p className={styles.note}>{t("code.conflict.draftKept")}</p>
          <div className={styles.actions}>
            {props.canProposePull && (
              <Button
                variant="primary"
                wide
                icon={<GitBranch aria-hidden />}
                isDisabled={offline}
                onPress={commitToNewBranch}
              >
                {t("code.commit.newBranchInstead")}
              </Button>
            )}
            <Button
              variant="plain"
              wide
              onPress={() => {
                setView("form");
              }}
            >
              {t("code.conflict.backToCommit")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (branchValid && !pending && !offline) submit(mode);
          }}
        >
          <TextField
            label={t("code.commit.message")}
            placeholder={defaultMessage}
            value={headline}
            onChange={setHeadline}
            isDisabled={pending}
          />
          <TextArea
            label={t("code.commit.description")}
            value={description}
            onChange={setDescription}
            isDisabled={pending}
          />
          {!props.canProposePull ? (
            <p className={styles.note}>{t("code.commit.direct", { branch: subject.branch })}</p>
          ) : props.canPush ? (
            <RadioGroup
              value={mode}
              onChange={(value) => {
                setBranchMode(value === "direct" ? "direct" : "newBranch");
                setProblem(null);
              }}
              isDisabled={pending}
              className={moduleClass(styles.choices)}
            >
              <Label className={styles.label}>{t("code.commit.target")}</Label>
              <RadioField value="direct">
                <RadioButton className={moduleClass(styles.choice)}>
                  <span className={styles.radio} aria-hidden />
                  <span>{t("code.commit.direct", { branch: subject.branch })}</span>
                </RadioButton>
              </RadioField>
              <RadioField value="newBranch">
                <RadioButton className={moduleClass(styles.choice)}>
                  <span className={styles.radio} aria-hidden />
                  <span>{t("code.commit.newBranch")}</span>
                </RadioButton>
              </RadioField>
            </RadioGroup>
          ) : (
            <p className={styles.note}>
              <GitPullRequest aria-hidden />
              {t("code.commit.forkExplanation", { repo: `${subject.owner}/${subject.repo}` })}
            </p>
          )}
          {mode === "direct" ? null : (
            <TextField
              label={t("code.commit.branchName")}
              value={branchName}
              onChange={setCustomBranchName}
              isDisabled={pending}
              isInvalid={!branchValid}
              validate={() => (branchValid ? null : t("code.commit.branchInvalid"))}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          )}
          {offline ? <p className={styles.note}>{t("code.create.offline")}</p> : null}
          {activeProblem ? (
            <ProblemNotice
              problem={activeProblem}
              branch={subject.branch}
              onViewLatest={() => {
                setView("latest");
              }}
              onNewBranch={props.canProposePull ? commitToNewBranch : undefined}
              onRetryDirect={() => {
                submit("direct");
              }}
              onChangePath={props.onChangePath}
            />
          ) : null}
          {isOrgAccessRestricted(activeMutation.error) ? (
            <ErrorState error={activeMutation.error} />
          ) : null}
          {pending && step ? <Progress mode={mode} step={step} isCreate={isCreate} /> : null}
          <Button
            type="submit"
            variant={activeProblem ? "secondary" : "primary"}
            wide
            isPending={pending}
            isDisabled={!branchValid || offline}
          >
            {t(
              mode === "direct"
                ? isCreate
                  ? "code.create.submitDirect"
                  : "code.commit.submitDirect"
                : isCreate
                  ? "code.create.submitPullRequest"
                  : "code.commit.submitPullRequest",
            )}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
