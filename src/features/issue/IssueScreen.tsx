import { useEffect } from "react";
import { Lock } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { ScreenSkeleton } from "@/app/navigation/ScreenSkeleton.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { issueRoute } from "@/app/router.ts";
import { useIssue, type IssueDetail } from "@/data/issues";
import { usePullRequest } from "@/data/pulls";
import { useT } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { CommentCard } from "./CommentCard.tsx";
import { ConversationComposer } from "./ConversationComposer.tsx";
import { issueSubjectState } from "@/ui/SubjectStatus.tsx";
import { useSubjectActions } from "./subject-actions.tsx";
import { SubjectHeader } from "./SubjectHeader.tsx";
import { SubjectMetadata } from "./SubjectMetadata.tsx";
import { Timeline } from "./Timeline.tsx";
import styles from "./Conversation.module.css";

function IssueConversation(props: { issue: IssueDetail }) {
  const t = useT();
  const { issue } = props;
  const actions = useSubjectActions({
    ...issue,
    kind: "issue",
    closedReason: issue.stateReason === "notPlanned" ? "notPlanned" : "completed",
  });
  return (
    <Page title={issue.title} largeTitle menuActions={actions}>
      <SubjectHeader
        state={issueSubjectState(issue.state, issue.stateReason)}
        repo={issue.repo}
        number={issue.number}
        author={issue.author}
        createdAt={issue.createdAt}
      />
      {issue.locked ? (
        <div className={styles.banner}>
          <Banner icon={<Lock />}>{t("issue.locked")}</Banner>
        </div>
      ) : null}
      <SubjectMetadata subject={issue} />
      <CommentCard
        subjectId={issue.id}
        author={issue.author}
        createdAt={issue.createdAt}
        bodyHtml={issue.bodyHtml}
        reactions={issue.reactions}
        canReact={issue.viewerCan.react}
        isOpeningPost
      />
      <Timeline repo={issue.repo} number={issue.number} />
      {issue.viewerCan.comment ? (
        <ConversationComposer subjectId={issue.id} repo={issue.repo} number={issue.number} />
      ) : null}
    </Page>
  );
}

export default function IssueScreen() {
  const router = useRouter();
  const { owner, repo, number } = useScreenParams(issueRoute);
  const issue = useIssue(owner, repo, number);
  // Issue numbers can identify pull requests.
  const pull = usePullRequest(owner, repo, number);
  const isPull = pull.isSuccess;

  useEffect(() => {
    if (isPull) router.history.replace(`/${owner}/${repo}/pull/${String(number)}`);
  }, [isPull, router, owner, repo, number]);

  if (issue.isSuccess) return <IssueConversation issue={issue.data} />;
  const title = `#${String(number)}`;
  if (issue.isPending || isPull || pull.isPending) {
    return (
      <Page title={title}>
        <ScreenSkeleton />
      </Page>
    );
  }
  return (
    <Page title={title}>
      <ErrorState
        error={issue.error}
        fullScreen={isFullScreenError(issue.error)}
        onRetry={() => void issue.refetch()}
      />
    </Page>
  );
}
