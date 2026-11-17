import { useScreenParams } from "@/app/navigation/screen.ts";
import { issuesRoute } from "@/app/router.ts";
import { IssueList } from "./IssueList.tsx";

export default function IssueListScreen() {
  const { owner, repo } = useScreenParams(issuesRoute);
  return <IssueList owner={owner} repo={repo} kind="issues" />;
}
