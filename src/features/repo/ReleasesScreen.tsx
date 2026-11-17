import { Tag } from "lucide-react";
import { Link } from "react-aria-components/Link";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { releasesRoute } from "@/app/router.ts";
import { useReleases } from "@/data/repo";
import type { Release } from "@/data/types";
import { useT } from "@/i18n/index.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { InfiniteList } from "@/ui/VirtualList.tsx";
import styles from "./lists.module.css";

const ROW_ESTIMATE_PX = 72;

export function releasePath(release: Release): string {
  return `/${release.repo.owner}/${release.repo.name}/releases/tag/${encodeURIComponent(release.tagName)}`;
}

function ReleaseRow(props: { release: Release }) {
  const t = useT();
  const { release } = props;
  return (
    <Link href={releasePath(release)} className={moduleClass(styles.row)}>
      <Tag className={styles.icon} aria-hidden />
      <span className={styles.body}>
        <span className={styles.title}>{release.name}</span>
        <span className={styles.meta}>
          <span className={styles.mono}>{release.tagName}</span>
          {release.isPrerelease ? (
            <span className={styles.pill}>{t("repo.releases.prerelease")}</span>
          ) : null}
          <RelativeTime date={release.publishedAt} />
          {release.author ? <span>{release.author.login}</span> : null}
        </span>
      </span>
    </Link>
  );
}

export default function ReleasesScreen() {
  const t = useT();
  const { owner, repo } = useScreenParams(releasesRoute);
  const releases = useReleases(owner, repo);
  return (
    <Page title={t("repo.releases.title")}>
      <InfiniteList
        separators
        query={releases}
        label={t("repo.releases.title")}
        estimateSize={ROW_ESTIMATE_PX}
        getKey={(release) => release.tagName}
        renderItem={(release) => <ReleaseRow release={release} />}
        empty={
          <EmptyState
            icon={<Tag />}
            title={t("repo.releases.empty")}
            message={t("repo.releases.emptyMessage")}
          />
        }
      />
    </Page>
  );
}
