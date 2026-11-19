import { useState } from "react";
import { GitBranch, GitPullRequest } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Link } from "react-aria-components/Link";
import { moduleClass } from "@/ui/module-class.ts";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { compareRoute } from "@/app/router.ts";
import { refName } from "@/data/links";
import { useBranchComparison, useCreatePullRequest } from "@/data/pulls/create";
import { useRepository } from "@/data/repo";
import { useIsOffline } from "@/data/status";
import { RefSheet } from "@/features/repo/RefSheet.tsx";
import { useT } from "@/i18n/index.tsx";
import { Button } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { TextArea, TextField } from "@/ui/TextField.tsx";
import styles from "./NewPull.module.css";

function ProposalForm(props: { owner: string; repo: string; defaultBranch: string }) {
  const t = useT();
  const router = useRouter();
  const offline = useIsOffline();
  const [base, setBase] = useState(props.defaultBranch);
  const [head, setHead] = useState("");
  const [pick, setPick] = useState<"base" | "head" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const comparison = useBranchComparison(props.owner, props.repo, base, head);
  const create = useCreatePullRequest(props.owner, props.repo);
  const locked = create.isPending || offline;
  const proposal = comparison.isError ? undefined : comparison.data;
  const canSubmit =
    !locked && Boolean(title.trim() && proposal && proposal.aheadBy > 0 && head !== base);
  const repoPath = `/${props.owner}/${props.repo}`;
  if (create.data)
    return (
      <Link
        className={moduleClass(styles.created)}
        href={`${repoPath}/pull/${String(create.data)}`}
      >
        {t("pull.new.created", { number: create.data })}
      </Link>
    );
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || !proposal) return;
        create.mutate(
          {
            repositoryId: proposal.repositoryId,
            baseRefName: base,
            headRefName: head,
            title: title.trim(),
            body,
            draft,
          },
          {
            onSuccess: (number) => {
              if (router.history.location.pathname === `${repoPath}/compare`)
                router.history.replace(`${repoPath}/pull/${String(number)}`);
            },
          },
        );
      }}
    >
      <div className={styles.identity}>
        {props.owner} / <strong>{props.repo}</strong>
      </div>
      <div className={styles.branches}>
        {(["base", "head"] as const).map((side) => {
          const branch = side === "base" ? base : head;
          return (
            <div className={styles.branch} key={side}>
              <span>{t(`pull.new.${side}`)}</span>
              <Button
                aria-label={`${t(`pull.new.${side}`)} · ${branch || t("pull.new.select")}`}
                icon={<GitBranch aria-hidden />}
                onPress={() => {
                  setPick(side);
                }}
                isDisabled={locked}
              >
                {branch || t("pull.new.select")}
              </Button>
            </div>
          );
        })}
      </div>
      {pick ? (
        <RefSheet
          owner={props.owner}
          repo={props.repo}
          current={pick === "base" ? base : head}
          branchesOnly
          onSelect={(ref) => {
            (pick === "base" ? setBase : setHead)(refName(ref));
            setPick(null);
            create.reset();
          }}
          onClose={() => {
            setPick(null);
          }}
        />
      ) : null}
      {head && head !== base && comparison.isError ? (
        <ErrorState error={comparison.error} onRetry={() => void comparison.refetch()} />
      ) : null}
      {head && !comparison.isError ? (
        <p role="status" className={styles.status}>
          {head === base || proposal?.aheadBy === 0
            ? t("pull.new.noChanges")
            : proposal
              ? t("pull.new.summary", { ahead: proposal.aheadBy, behind: proposal.behindBy })
              : t("pull.new.comparing")}
        </p>
      ) : null}
      <TextField
        label={t("pull.new.title")}
        isRequired
        isDisabled={locked}
        value={title}
        onChange={setTitle}
      />
      <TextArea label={t("pull.new.body")} isDisabled={locked} value={body} onChange={setBody} />
      <Switch isSelected={draft} onChange={setDraft} isDisabled={locked}>
        {t("pull.new.draft")}
      </Switch>
      {create.error ? <ErrorState error={create.error} /> : null}
      <Button variant="primary" type="submit" isPending={create.isPending} isDisabled={!canSubmit}>
        {t(draft ? "pull.new.submitDraft" : "pull.new.submit")}
      </Button>
    </form>
  );
}

export default function NewPullScreen() {
  const t = useT();
  const { owner, repo } = useScreenParams(compareRoute);
  const repository = useRepository(owner, repo);
  return (
    <Page title={t("pull.new.screen")} openOnGitHub={false}>
      {repository.isError ? (
        <ErrorState error={repository.error} onRetry={() => void repository.refetch()} />
      ) : null}
      {repository.data ? (
        repository.data.viewerCanProposePull && repository.data.defaultBranch ? (
          <ProposalForm owner={owner} repo={repo} defaultBranch={repository.data.defaultBranch} />
        ) : (
          <EmptyState
            icon={<GitPullRequest />}
            title={t("pull.new.unavailable")}
            message={t("pull.new.access")}
          />
        )
      ) : repository.isPending ? (
        <SkeletonRows />
      ) : null}
    </Page>
  );
}
