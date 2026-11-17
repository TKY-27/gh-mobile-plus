import type { ReactNode } from "react";
import { FileDiff, GitBranch, GitPullRequestDraft, Lock } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { useSetDraft, type PullRequestDetail } from "@/data/pulls";
import { richMessage } from "@/features/issue/rich-message.tsx";
import { pullSubjectState } from "@/ui/SubjectStatus.tsx";
import { useSubjectActions } from "@/features/issue/subject-actions.tsx";
import { SubjectHeader } from "@/features/issue/SubjectHeader.tsx";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import type { MenuAction } from "@/ui/Menu.tsx";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { showToast } from "@/ui/Toast.tsx";
import styles from "./Pull.module.css";
import { showErrorToast } from "@/ui/error-toast.ts";

export type PullTab = "conversation" | "files" | "checks" | "commits";

const TAB_PATHS: Readonly<Record<PullTab, string>> = {
  conversation: "",
  files: "/files",
  checks: "/checks",
  commits: "/commits",
};

export function pullPath(pull: Pick<PullRequestDetail, "repo" | "number">, tab: PullTab): string {
  return `/${pull.repo.owner}/${pull.repo.name}/pull/${String(pull.number)}${TAB_PATHS[tab]}`;
}

export function useDraftToggle(pull: PullRequestDetail) {
  const t = useT();
  const setDraft = useSetDraft();
  const toggle = (draft: boolean) => {
    setDraft.mutate(
      {
        pullRequestId: pull.id,
        owner: pull.repo.owner,
        repo: pull.repo.name,
        number: pull.number,
        draft,
      },
      {
        onSuccess: () => {
          showToast(t(draft ? "pull.draft.converted" : "pull.draft.ready"));
        },
        onError: (error) => {
          showErrorToast(t, error, t("pull.draft.failed"), () => {
            toggle(draft);
          });
        },
      },
    );
  };
  return { toggle, isPending: setDraft.isPending };
}

export function PullPage(props: { pull: PullRequestDetail; tab: PullTab; children: ReactNode }) {
  const t = useT();
  const formatters = useFormatters();
  const router = useRouter();
  const { pull } = props;
  const subjectActions = useSubjectActions({
    ...pull,
    kind: "pullRequest",
    state: pull.state,
    closedReason: "completed",
  });
  const draft = useDraftToggle(pull);
  const canConvert = pull.state === "open" && !pull.isDraft && pull.viewerCan.markReady;
  const draftActions: MenuAction[] = canConvert
    ? [
        {
          id: "convert-to-draft",
          label: t("pull.draft.convert"),
          icon: <GitPullRequestDraft aria-hidden />,
          onAction: () => {
            draft.toggle(true);
          },
        },
      ]
    : [];
  const segments = [
    { id: "conversation" as const, label: t("pull.tabs.conversation") },
    {
      id: "files" as const,
      label: t("pull.tabs.files"),
      count: formatters.number(pull.changedFiles),
    },
    { id: "checks" as const, label: t("pull.tabs.checks") },
    {
      id: "commits" as const,
      label: t("pull.tabs.commits"),
      count: formatters.number(pull.commitsCount),
    },
  ];

  return (
    <Page title={pull.title} largeTitle menuActions={[...draftActions, ...subjectActions]}>
      <SubjectHeader
        state={pullSubjectState(pull.state, pull.isDraft)}
        repo={pull.repo}
        number={pull.number}
        author={pull.author}
        createdAt={pull.createdAt}
      >
        <p className={styles.branches}>
          {richMessage(t, "pull.header.branches", {
            head: (
              <code className={styles.branch}>
                <GitBranch aria-hidden />
                {pull.headRepo && pull.headRepo.owner !== pull.repo.owner
                  ? `${pull.headRepo.owner}:${pull.headRef}`
                  : pull.headRef}
              </code>
            ),
            base: (
              <code className={styles.branch}>
                <GitBranch aria-hidden />
                {pull.baseRef}
              </code>
            ),
          })}
        </p>
        <p className={styles.diffStat}>
          <FileDiff aria-hidden />
          <span className={styles.additions}>
            {t("pull.header.additions", { count: pull.additions })}
          </span>
          <span className={styles.deletions}>
            {t("pull.header.deletions", { count: pull.deletions })}
          </span>
        </p>
      </SubjectHeader>
      {pull.locked ? (
        <div className={styles.banner}>
          <Banner icon={<Lock />}>{t("issue.locked")}</Banner>
        </div>
      ) : null}
      <div className={styles.tabs}>
        <SegmentedControl
          label={t("pull.tabs.label")}
          segments={segments}
          selected={props.tab}
          onChange={(tab) => {
            router.history.replace(pullPath(pull, tab));
          }}
        />
      </div>
      {props.children}
    </Page>
  );
}

export function PullGate(props: {
  query: UseQueryResult<PullRequestDetail>;
  number: number;
  children: (pull: PullRequestDetail) => ReactNode;
}) {
  const { query } = props;
  if (query.isSuccess) return props.children(query.data);
  const title = `#${String(props.number)}`;
  if (query.isPending) {
    return (
      <Page title={title}>
        <ScreenSkeleton />
      </Page>
    );
  }
  return (
    <Page title={title}>
      <ErrorState
        error={query.error}
        fullScreen={isFullScreenError(query.error)}
        onRetry={() => void query.refetch()}
      />
    </Page>
  );
}
