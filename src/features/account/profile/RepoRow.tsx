import { BookMarked, GitFork, Lock, Star } from "lucide-react";
import { Link } from "react-aria-components/Link";
import type { RepoSummary } from "@/data/types";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import styles from "./Profile.module.css";

export const REPO_ROW_ESTIMATE_PX = 96;

export function RepoRow(props: { repo: RepoSummary; showOwner: boolean }) {
  const t = useT();
  const formatters = useFormatters();
  const { repo } = props;
  const Icon = repo.isFork ? GitFork : BookMarked;
  return (
    <Link href={`/${repo.owner}/${repo.name}`} className={moduleClass(styles.repo)}>
      <span className={styles.repoTitle}>
        <Icon className={styles.repoIcon} aria-hidden />
        <span className={styles.repoName}>
          {props.showOwner ? <span className={styles.repoOwner}>{repo.owner}/</span> : null}
          {repo.name}
        </span>
        {repo.isPrivate ? (
          <span className={styles.private}>
            <Lock aria-hidden />
            {t("account.repo.private")}
          </span>
        ) : null}
      </span>
      {repo.isFork ? <span className={styles.srOnly}>{t("account.repo.fork")}</span> : null}
      {repo.description ? <span className={styles.description}>{repo.description}</span> : null}
      <span className={styles.meta}>
        {repo.language ? (
          <span className={styles.metaItem}>
            <span
              className={styles.languageDot}
              style={{ background: repo.language.color ?? "var(--color-text-tertiary)" }}
              aria-hidden
            />
            {repo.language.name}
          </span>
        ) : null}
        <span className={styles.metaItem}>
          <Star aria-hidden />
          <span aria-hidden>{formatters.compactNumber(repo.stars)}</span>
          <span className={styles.srOnly}>{t("account.repo.stars", { count: repo.stars })}</span>
        </span>
        <span className={styles.metaItem}>
          {t("account.repo.updated")} <RelativeTime date={repo.updatedAt} />
        </span>
      </span>
    </Link>
  );
}
