import { Building2, FileCode, Lock, Star } from "lucide-react";
import { Link } from "react-aria-components/Link";
import type { SearchResult } from "@/data/search";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { issueSubjectState, pullSubjectState, SubjectStateIcon } from "@/ui/SubjectStatus.tsx";
import styles from "./SearchResultRow.module.css";

const AVATAR_PX = 36;
const REPO_ROW_PX = 84;
const ISSUE_ROW_PX = 72;
const USER_ROW_PX = 60;
const CODE_ROW_PX = 96;

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function resultPath(result: SearchResult): string {
  switch (result.kind) {
    case "repository":
      return `/${result.repo.owner}/${result.repo.name}`;
    case "issue":
      return `/${result.repo.owner}/${result.repo.name}/${result.isPullRequest ? "pull" : "issues"}/${String(result.number)}`;
    case "user":
      return `/${result.login}`;
    case "code":
      return `/${result.repo.owner}/${result.repo.name}/blob/${encodePath(result.ref)}/${encodePath(result.path)}`;
  }
}

export function estimateResult(result: SearchResult): number {
  switch (result.kind) {
    case "repository":
      return REPO_ROW_PX;
    case "issue":
      return ISSUE_ROW_PX;
    case "user":
      return USER_ROW_PX;
    case "code":
      return CODE_ROW_PX;
  }
}

function ResultContent(props: { result: SearchResult }) {
  const t = useT();
  const formatters = useFormatters();
  const { result } = props;
  switch (result.kind) {
    case "repository": {
      const { repo } = result;
      return (
        <span className={styles.text}>
          <span className={styles.title}>
            {repo.owner}/<strong>{repo.name}</strong>
            {repo.isPrivate ? (
              <Lock className={styles.inlineIcon} role="img" aria-label={t("search.private")} />
            ) : null}
          </span>
          {repo.description ? <span className={styles.description}>{repo.description}</span> : null}
          <span className={styles.meta}>
            <span className={styles.metaItem}>
              <Star className={styles.inlineIcon} aria-hidden />
              <span>
                {t("search.stars", {
                  count: repo.stars,
                  formatted: formatters.compactNumber(repo.stars),
                })}
              </span>
            </span>
            {repo.language ? (
              <span className={styles.metaItem}>
                <span
                  className={styles.language}
                  style={repo.language.color ? { background: repo.language.color } : undefined}
                  aria-hidden
                />
                {repo.language.name}
              </span>
            ) : null}
            <RelativeTime date={repo.updatedAt} />
          </span>
        </span>
      );
    }
    case "issue": {
      const state = result.isPullRequest
        ? pullSubjectState(result.state, result.isDraft)
        : issueSubjectState(result.state === "open" ? "open" : "closed", result.closedReason);
      return (
        <>
          <SubjectStateIcon state={state} />
          <span className={styles.text}>
            <span className={styles.meta}>
              {result.repo.owner}/{result.repo.name} #{result.number}
            </span>
            <span className={styles.title}>{result.title}</span>
            <span className={styles.meta}>
              <RelativeTime date={result.updatedAt} />
            </span>
          </span>
        </>
      );
    }
    case "user":
      return (
        <>
          <Avatar src={result.avatarUrl} name={result.login} size={AVATAR_PX} />
          <span className={styles.text}>
            <span className={styles.title}>
              {result.login}
              {result.isOrganization ? (
                <Building2
                  className={styles.inlineIcon}
                  role="img"
                  aria-label={t("search.organization")}
                />
              ) : null}
            </span>
            {result.name ? <span className={styles.meta}>{result.name}</span> : null}
          </span>
        </>
      );
    case "code":
      return (
        <>
          <FileCode className={styles.codeIcon} aria-hidden />
          <span className={styles.text}>
            <span className={styles.meta}>
              {result.repo.owner}/{result.repo.name}
            </span>
            <span className={styles.path}>{result.path}</span>
            {result.fragment ? <code className={styles.fragment}>{result.fragment}</code> : null}
          </span>
        </>
      );
  }
}

export function SearchResultRow(props: { result: SearchResult }) {
  return (
    <Link href={resultPath(props.result)} className={moduleClass(styles.row)}>
      <ResultContent result={props.result} />
    </Link>
  );
}
