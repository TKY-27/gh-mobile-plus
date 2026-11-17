import { openExternal } from "@/ui/external.ts";
import { Download, Package, Tag } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { releaseRoute } from "@/app/router.ts";
import { toAppPath } from "@/data/links";
import { useRelease } from "@/data/repo";
import { useIsOffline } from "@/data/status";
import { useFormatSize } from "@/features/code/size.ts";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { SafeHtml } from "@/markdown/SafeHtml.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { Skeleton } from "@/ui/Skeleton.tsx";
import styles from "./ReleaseScreen.module.css";

const AUTHOR_AVATAR_PX = 20;

export default function ReleaseScreen() {
  const t = useT();
  const router = useRouter();
  const formatters = useFormatters();
  const formatSize = useFormatSize();
  const offline = useIsOffline();
  const { owner, repo, tag } = useScreenParams(releaseRoute);
  const release = useRelease(owner, repo, tag);

  if (release.isPending) {
    return (
      <Page title={tag} largeTitle>
        <div className={styles.skeleton} aria-busy="true">
          <Skeleton width="40%" height="1rem" />
          <Skeleton width="100%" height="1rem" />
          <Skeleton width="85%" height="1rem" />
        </div>
      </Page>
    );
  }
  if (release.isError) {
    return (
      <Page title={tag} largeTitle>
        <ErrorState
          error={release.error}
          fullScreen={isFullScreenError(release.error)}
          onRetry={() => void release.refetch()}
        />
      </Page>
    );
  }

  const detail = release.data;
  return (
    <Page title={detail.name} largeTitle>
      <div className={styles.meta}>
        <span className={styles.tag}>
          <Tag aria-hidden />
          {detail.tagName}
        </span>
        {detail.isPrerelease ? (
          <span className={styles.pill}>{t("repo.releases.prerelease")}</span>
        ) : null}
        {detail.author ? (
          <span className={styles.author}>
            <Avatar
              src={detail.author.avatarUrl}
              name={detail.author.login}
              size={AUTHOR_AVATAR_PX}
            />
            {detail.author.login}
          </span>
        ) : null}
        <RelativeTime date={detail.publishedAt} />
      </div>
      {detail.notesHtml ? (
        <SafeHtml
          html={detail.notesHtml}
          className={moduleClass(styles.notes)}
          toAppPath={toAppPath}
          onNavigate={(appPath) => {
            router.history.push(appPath);
          }}
          offline={offline}
          offlineImageLabel={t("repo.offlineImage")}
        />
      ) : (
        <p className={styles.noNotes}>{t("repo.releases.noNotes")}</p>
      )}
      {detail.assets.length === 0 ? (
        <p className={styles.noNotes}>{t("repo.releases.noAssets")}</p>
      ) : (
        <ListSection title={t("repo.releases.assets")}>
          {detail.assets.map((asset) => (
            <ListRow
              key={asset.name}
              leading={<Package aria-hidden />}
              title={asset.name}
              subtitle={t("repo.releases.assetMeta", {
                size: formatSize(asset.size),
                downloads: formatters.number(asset.downloadCount),
              })}
              trailing={<Download className={styles.download} aria-hidden />}
              onPress={() => {
                openExternal(asset.downloadUrl);
              }}
            />
          ))}
        </ListSection>
      )}
    </Page>
  );
}
