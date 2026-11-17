import { useScreenParams } from "@/app/navigation/screen.ts";
import { pullRoute } from "@/app/router.ts";
import { usePullRequest, type PullRequestDetail } from "@/data/pulls";
import { CommentCard } from "@/features/issue/CommentCard.tsx";
import { ConversationComposer } from "@/features/issue/ConversationComposer.tsx";
import { SubjectMetadata } from "@/features/issue/SubjectMetadata.tsx";
import { Timeline } from "@/features/issue/Timeline.tsx";
import { MergeBox } from "./MergeBox.tsx";
import { PullGate, PullPage } from "./PullPage.tsx";
import { Reviewers } from "./Reviewers.tsx";

function Conversation(props: { pull: PullRequestDetail }) {
  const { pull } = props;
  return (
    <PullPage pull={pull} tab="conversation">
      <MergeBox pull={pull} />
      <Reviewers pull={pull} />
      <SubjectMetadata subject={pull} />
      <CommentCard
        subjectId={pull.id}
        author={pull.author}
        createdAt={pull.createdAt}
        bodyHtml={pull.bodyHtml}
        reactions={pull.reactions}
        canReact={pull.viewerCan.react}
        isOpeningPost
      />
      <Timeline repo={pull.repo} number={pull.number} />
      {pull.viewerCan.comment ? (
        <ConversationComposer subjectId={pull.id} repo={pull.repo} number={pull.number} />
      ) : null}
    </PullPage>
  );
}

export default function PullScreen() {
  const { owner, repo, number } = useScreenParams(pullRoute);
  const pull = usePullRequest(owner, repo, number);
  return (
    <PullGate query={pull} number={number}>
      {(detail) => <Conversation pull={detail} />}
    </PullGate>
  );
}
