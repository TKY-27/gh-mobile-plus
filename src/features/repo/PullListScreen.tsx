import { useScreenParams } from "@/app/navigation/screen.ts";
import { pullsRoute } from "@/app/router.ts";
import { IssueList } from "./IssueList.tsx";

export default function PullListScreen() {
  const { owner, repo } = useScreenParams(pullsRoute);
  return <IssueList owner={owner} repo={repo} kind="pulls" />;
}
