import { Tag } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import { useStarredReleases } from "@/data/home";
import { useT } from "@/i18n/index.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { ListSection } from "@/ui/ListRow.tsx";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { ReleaseRow, releaseKey } from "./ReleaseRow.tsx";

export default function StarredReleasesScreen() {
  const t = useT();
  const releases = useStarredReleases();
  let body;
  if (releases.isPending) body = <SkeletonRows />;
  else if (releases.isError) {
    body = (
      <ErrorState
        error={releases.error}
        onRetry={() => void releases.refetch()}
        fullScreen={isFullScreenError(releases.error)}
      />
    );
  } else if (releases.data.length === 0) {
    body = (
      <EmptyState
        icon={<Tag />}
        title={t("home.releases.empty.title")}
        message={t("home.releases.empty.message")}
      />
    );
  } else {
    body = (
      <ListSection footer={t("home.releases.footnote")}>
        {releases.data.map((release) => (
          <ReleaseRow key={releaseKey(release)} release={release} />
        ))}
      </ListSection>
    );
  }
  return (
    <Page title={t("home.releases.title")} openOnGitHub={false}>
      {body}
    </Page>
  );
}
