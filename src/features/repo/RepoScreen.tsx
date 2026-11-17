import { useId, useState } from "react";
import {
  BookOpen,
  ChevronsUpDown,
  CircleDot,
  CirclePlay,
  Eye,
  FileCode,
  GitBranch,
  GitFork,
  GitPullRequest,
  Lock,
  Scale,
  Star,
  Tag,
} from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Link } from "react-aria-components/Link";
import { VisuallyHidden } from "react-aria-components/VisuallyHidden";
import { Page } from "@/app/Page.tsx";
import { useScreenParams } from "@/app/navigation/screen.ts";
import { repoRoute } from "@/app/router.ts";
import type { GitHubError } from "@/data/errors";
import { qualifiedRef, refKind, refName, toAppPath } from "@/data/links";
import { useReadme, useRepository, useStar, useWatch, type Repository } from "@/data/repo";
import { useIsOffline } from "@/data/status";
import { treePath } from "@/features/code/paths.ts";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { SafeHtml } from "@/markdown/SafeHtml.tsx";
import { Button } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { describeError, ErrorState, isFullScreenError } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Skeleton } from "@/ui/Skeleton.tsx";
import { showErrorToast } from "@/ui/error-toast.ts";
import { openExternal } from "@/ui/external.ts";
import { RefSheet } from "./RefSheet.tsx";
import styles from "./RepoScreen.module.css";

function useFailureToast() {
  const t = useT();
  const formatters = useFormatters();
  return (error: GitHubError, retry: () => void) => {
    showErrorToast(t, error, describeError(t, formatters, error, Date.now()).title, retry);
  };
}

function Header(props: { repository: Repository }) {
  const t = useT();
  const formatters = useFormatters();
  const { repository } = props;
  const stats = [
    { icon: Star, key: "repo.stats.stars", count: repository.stars },
    { icon: GitFork, key: "repo.stats.forks", count: repository.forks },
    { icon: Eye, key: "repo.stats.watchers", count: repository.watchers },
  ] as const;
  return (
    <div className={styles.header}>
      <Link href={`/${repository.owner}`} className={moduleClass(styles.owner)}>
        {repository.owner}
      </Link>
      {repository.isPrivate || repository.parent ? (
        <p className={styles.badges}>
          {repository.isPrivate ? (
            <span className={styles.badge}>
              <Lock aria-hidden />
              {t("repo.private")}
            </span>
          ) : null}
          {repository.parent ? (
            <span className={styles.forkOf}>
              <GitFork aria-hidden />
              {t("repo.forkOf")}{" "}
              <Link
                href={`/${repository.parent.owner}/${repository.parent.name}`}
                className={moduleClass(styles.inlineLink)}
              >
                {repository.parent.owner}/{repository.parent.name}
              </Link>
            </span>
          ) : null}
        </p>
      ) : null}
      {repository.description ? (
        <p className={styles.description}>{repository.description}</p>
      ) : null}
      <ul className={styles.stats}>
        {stats.map(({ icon: Icon, key, count }) => (
          <li key={key}>
            <Icon aria-hidden />
            <span aria-hidden>{formatters.compactNumber(count)}</span>
            <span className={styles.statLabel} aria-hidden>
              {t(key, { count })}
            </span>
            <VisuallyHidden>{t(`${key}Full`, { count })}</VisuallyHidden>
          </li>
        ))}
      </ul>
      {repository.language || repository.license ? (
        <p className={styles.meta}>
          {repository.language ? (
            <span>
              <span
                className={styles.languageDot}
                style={{ background: repository.language.color ?? "var(--color-text-tertiary)" }}
                aria-hidden
              />
              {repository.language.name}
            </span>
          ) : null}
          {repository.license ? (
            <span>
              <Scale aria-hidden />
              {repository.license}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Actions(props: { repository: Repository }) {
  const t = useT();
  const star = useStar();
  const watch = useWatch();
  const toastFailure = useFailureToast();
  const { repository } = props;
  const { owner, name: repo } = repository;
  const watching = repository.viewerSubscription === "subscribed";

  const toggleStar = (next: boolean) => {
    star.mutate(
      { owner, repo, star: next },
      {
        onError: (error) => {
          toastFailure(error, () => {
            toggleStar(next);
          });
        },
      },
    );
  };
  const toggleWatch = (next: boolean) => {
    watch.mutate(
      { owner, repo, subscribe: next },
      {
        onError: (error) => {
          toastFailure(error, () => {
            toggleWatch(next);
          });
        },
      },
    );
  };

  return (
    <div className={styles.actions}>
      <Button
        aria-pressed={repository.viewerHasStarred}
        icon={
          <Star
            className={styles.toggleIcon}
            data-on={repository.viewerHasStarred || undefined}
            aria-hidden
          />
        }
        onPress={() => {
          toggleStar(!repository.viewerHasStarred);
        }}
      >
        {t("repo.star")}
      </Button>
      <Button
        aria-pressed={watching}
        icon={<Eye className={styles.toggleIcon} data-on={watching || undefined} aria-hidden />}
        onPress={() => {
          toggleWatch(!watching);
        }}
      >
        {t("repo.watch")}
      </Button>
      <Button
        icon={<GitFork className={styles.toggleIcon} aria-hidden />}
        onPress={() => {
          openExternal(`${repository.webUrl}/fork`);
        }}
      >
        {t("repo.fork")}
      </Button>
    </div>
  );
}

function Readme(props: { owner: string; repo: string; gitRef: string | null }) {
  const t = useT();
  const router = useRouter();
  const offline = useIsOffline();
  const readme = useReadme(props.owner, props.repo, props.gitRef);
  if (readme.isPending) {
    return (
      <div className={styles.readmeSkeleton} aria-busy="true">
        <Skeleton width="60%" height="1.5rem" />
        <Skeleton width="100%" height="1rem" />
        <Skeleton width="90%" height="1rem" />
        <Skeleton width="75%" height="1rem" />
      </div>
    );
  }
  if (readme.isError) {
    return <ErrorState error={readme.error} onRetry={() => void readme.refetch()} />;
  }
  if (!readme.data) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title={t("repo.readme.empty")}
        message={t("repo.readme.emptyMessage")}
      />
    );
  }
  return (
    <article className={styles.readme} aria-label={readme.data.path}>
      <SafeHtml
        html={readme.data.html}
        toAppPath={toAppPath}
        onNavigate={(appPath) => {
          router.history.push(appPath);
        }}
        offline={offline}
        offlineImageLabel={t("repo.offlineImage")}
      />
    </article>
  );
}

export default function RepoScreen() {
  const t = useT();
  const { owner, repo } = useScreenParams(repoRoute);
  const repository = useRepository(owner, repo);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [choosingRef, setChoosingRef] = useState(false);
  const readmeHeading = useId();

  if (repository.isPending) {
    return (
      <Page title={repo} largeTitle>
        <div className={styles.headerSkeleton} aria-busy="true">
          <Skeleton width="30%" height="1rem" />
          <Skeleton width="90%" height="1rem" />
          <Skeleton width="60%" height="1rem" />
          <Skeleton width="100%" height="2.75rem" />
        </div>
      </Page>
    );
  }
  if (repository.isError) {
    return (
      <Page title={repo} largeTitle>
        <ErrorState
          error={repository.error}
          fullScreen={isFullScreenError(repository.error)}
          onRetry={() => void repository.refetch()}
        />
      </Page>
    );
  }

  const details = repository.data;
  const isEmpty = details.defaultBranch === "";
  const defaultRef = qualifiedRef("branches", details.defaultBranch);
  const gitRef = selectedRef ?? defaultRef;
  const name = refName(gitRef);
  const RefIcon = refKind(gitRef) === "tags" ? Tag : GitBranch;
  const base = `/${details.owner}/${details.name}`;

  return (
    <Page title={details.name} largeTitle>
      <Header repository={details} />
      <Actions repository={details} />
      <ListSection>
        {isEmpty ? null : (
          <ListRow
            leading={<FileCode aria-hidden />}
            title={t("repo.sections.code")}
            subtitle={name}
            href={treePath(details.owner, details.name, gitRef, "")}
          />
        )}
        {details.hasIssues ? (
          <ListRow
            leading={<CircleDot aria-hidden />}
            title={t("repo.sections.issues")}
            href={`${base}/issues`}
          />
        ) : null}
        <ListRow
          leading={<GitPullRequest aria-hidden />}
          title={t("repo.sections.pulls")}
          href={`${base}/pulls`}
        />
        <ListRow
          leading={<CirclePlay aria-hidden />}
          title={t("repo.sections.actions")}
          href={`${base}/actions`}
        />
        <ListRow
          leading={<Tag aria-hidden />}
          title={t("repo.sections.releases")}
          href={`${base}/releases`}
        />
      </ListSection>
      <section className={styles.readmeSection} aria-labelledby={readmeHeading}>
        <div className={styles.sectionHeader}>
          <h2 id={readmeHeading} className={styles.sectionTitle}>
            {t("repo.readme.title")}
          </h2>
          {isEmpty ? null : (
            <Button
              variant="plain"
              aria-label={t("repo.refs.switchFrom", { ref: name })}
              icon={<RefIcon className={styles.refIcon} aria-hidden />}
              onPress={() => {
                setChoosingRef(true);
              }}
            >
              <span className={styles.refName}>{name}</span>
              <ChevronsUpDown className={styles.chevrons} aria-hidden />
            </Button>
          )}
        </div>
        {isEmpty ? (
          <EmptyState
            icon={<BookOpen />}
            title={t("repo.empty.title")}
            message={t("repo.empty.message")}
          />
        ) : (
          <Readme owner={details.owner} repo={details.name} gitRef={selectedRef} />
        )}
      </section>
      {choosingRef ? (
        <RefSheet
          owner={details.owner}
          repo={details.name}
          current={gitRef}
          onSelect={(ref) => {
            setSelectedRef(ref === defaultRef ? null : ref);
            setChoosingRef(false);
          }}
          onClose={() => {
            setChoosingRef(false);
          }}
        />
      ) : null}
    </Page>
  );
}
