import { Tag } from "lucide-react";
import type { Release } from "@/data/types";
import { useT } from "@/i18n/index.tsx";
import { Badge } from "@/ui/Badge.tsx";
import { ListRow } from "@/ui/ListRow.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import styles from "./ReleaseRow.module.css";

export function releaseKey(release: Release): string {
  return `${release.repo.owner}/${release.repo.name}@${release.tagName}`;
}

export function ReleaseRow(props: { release: Release }) {
  const t = useT();
  const { release } = props;
  const { owner, name } = release.repo;
  return (
    <ListRow
      href={`/${owner}/${name}/releases/tag/${encodeURIComponent(release.tagName)}`}
      leading={<Tag aria-hidden className={styles.icon} />}
      title={
        <span className={styles.title}>
          <span className={styles.repo}>
            {owner}/{name}
          </span>{" "}
          <span className={styles.tag}>{release.tagName}</span>
        </span>
      }
      subtitle={
        <span className={styles.meta}>
          {release.name !== release.tagName ? (
            <span className={styles.name}>{release.name}</span>
          ) : null}
          <RelativeTime date={release.publishedAt} />
        </span>
      }
      trailing={release.isPrerelease ? <Badge>{t("home.releases.prerelease")}</Badge> : null}
    />
  );
}
