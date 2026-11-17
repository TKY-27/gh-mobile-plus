import { useLayoutEffect, useRef, useState } from "react";
import { Check, Circle, GitBranch, GitPullRequest, ShieldAlert, TriangleAlert } from "lucide-react";
import { Label } from "react-aria-components/Label";
import { RadioButton, RadioField, RadioGroup } from "react-aria-components/RadioGroup";
import {
  defaultBranchName,
  useCommitFileEdit,
  type CommitOutcome,
  type CommitStep,
  type CommitTarget,
} from "@/data/commit";
import type { GitHubError } from "@/data/errors";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { isOrgAccessRestricted, showErrorToast } from "@/ui/error-toast.ts";
import { describeError, ErrorState } from "@/ui/ErrorState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Sheet } from "@/ui/Sheet.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { TextArea, TextField } from "@/ui/TextField.tsx";
import { isValidBranchName } from "./branch-name.ts";
import { LatestDiff } from "./LatestDiff.tsx";
import styles from "./CommitSheet.module.css";

type Mode = CommitTarget["kind"];
type Problem = "conflict" | "protected" | null;

const STEPS: Readonly<Record<Mode, readonly CommitStep[]>> = {
  direct: ["committing"],
  newBranch: ["creatingBranch", "committing", "openingPullRequest"],
  fork: ["forking", "waitingForFork", "creatingBranch", "committing", "openingPullRequest"],
};

const STEP_LABELS: Readonly<Record<CommitStep, MessageKey>> = {
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

function Progress(props: { mode: Mode; step: CommitStep }) {
  const t = useT();
  const steps = STEPS[props.mode];
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
  problem: Exclude<Problem, null>;
  branch: string;
  onViewLatest: () => void;
  onNewBranch: () => void;
}) {
  const t = useT();
  const conflict = props.problem === "conflict";
  return (
    <div role="alert" className={styles.problem}>
      {conflict ? <TriangleAlert aria-hidden /> : <ShieldAlert aria-hidden />}
      <div className={styles.problemText}>
        <h3>{t(conflict ? "code.conflict.title" : "code.protected.title")}</h3>
        <p>
          {t(conflict ? "code.conflict.message" : "code.protected.message", {
            branch: props.branch,
          })}
        </p>
        <div className={styles.problemActions}>
          {conflict ? (
            <Button variant="secondary" onPress={props.onViewLatest}>
              {t("code.conflict.viewLatest")}
            </Button>
          ) : null}
          <Button variant="primary" icon={<GitBranch aria-hidden />} onPress={props.onNewBranch}>
            {t("code.commit.newBranchInstead")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Stay mounted to receive commit results.
export function CommitSheet(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  subject: EditSubject;
  canPush: boolean;
  login: string;
  onCommitted: (outcome: CommitOutcome) => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  const { subject } = props;
  const fileName = subject.path.split("/").at(-1) ?? subject.path;
  const [step, setStep] = useState<CommitStep | null>(null);
  const commit = useCommitFileEdit(setStep);
  const open = useRef(props.isOpen);
  useLayoutEffect(() => {
    open.current = props.isOpen;
  }, [props.isOpen]);
  const [view, setView] = useState<"form" | "latest">("form");
  const [mode, setMode] = useState<Mode>(props.canPush ? "newBranch" : "fork");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [branchName, setBranchName] = useState(() =>
    defaultBranchName(props.login, subject.path, new Date()),
  );
  const [problem, setProblem] = useState<Problem>(null);
  const message = headline.trim() || t("code.commit.defaultMessage", { name: fileName });
  const branchValid = mode === "direct" || isValidBranchName(branchName);

  const submit = (target: Mode) => {
    setProblem(null);
    setStep(null);
    const pullRequest = { title: message, body: description };
    const commitTarget: CommitTarget =
      target === "direct" ? { kind: "direct" } : { kind: target, branchName, pullRequest };
    commit.mutate(
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
      {
        onSuccess: props.onCommitted,
        onError: (error: GitHubError) => {
          if (target === "direct" && error.kind === "conflict") setProblem("conflict");
          else if (target === "direct" && error.kind === "forbidden") setProblem("protected");
          else if (!isOrgAccessRestricted(error) || !open.current) {
            const text = describeError(t, formatters, error, Date.now());
            showErrorToast(t, error, text.title, () => {
              submit(target);
            });
          }
        },
      },
    );
  };

  const commitToNewBranch = () => {
    const fallback = props.canPush ? "newBranch" : "fork";
    setMode(fallback);
    setView("form");
    submit(fallback);
  };

  const pending = commit.isPending;
  return (
    <Sheet
      isOpen={props.isOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) setView("form");
        props.onOpenChange(isOpen);
      }}
      title={t(view === "latest" ? "code.conflict.latestTitle" : "code.commit.title")}
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
            <Button
              variant="primary"
              wide
              icon={<GitBranch aria-hidden />}
              onPress={commitToNewBranch}
            >
              {t("code.commit.newBranchInstead")}
            </Button>
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
            if (branchValid && !pending) submit(mode);
          }}
        >
          <TextField
            label={t("code.commit.message")}
            placeholder={t("code.commit.defaultMessage", { name: fileName })}
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
          {props.canPush ? (
            <RadioGroup
              value={mode}
              onChange={(value) => {
                setMode(value === "direct" ? "direct" : "newBranch");
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
              onChange={setBranchName}
              isDisabled={pending}
              isInvalid={!branchValid}
              validate={() => (branchValid ? null : t("code.commit.branchInvalid"))}
              autoCorrect="off"
              spellCheck="false"
            />
          )}
          {problem ? (
            <ProblemNotice
              problem={problem}
              branch={subject.branch}
              onViewLatest={() => {
                setView("latest");
              }}
              onNewBranch={commitToNewBranch}
            />
          ) : null}
          {isOrgAccessRestricted(commit.error) ? <ErrorState error={commit.error} /> : null}
          {pending && step ? <Progress mode={mode} step={step} /> : null}
          <Button
            type="submit"
            variant={problem ? "secondary" : "primary"}
            wide
            isPending={pending}
            isDisabled={!branchValid}
          >
            {t(mode === "direct" ? "code.commit.submitDirect" : "code.commit.submitPullRequest")}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
