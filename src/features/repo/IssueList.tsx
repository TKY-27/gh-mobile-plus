import { useState } from "react";
import { CircleCheck, CircleDot, GitPullRequest, MessageSquare, Plus } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Link } from "react-aria-components/Link";
import { VisuallyHidden } from "react-aria-components/VisuallyHidden";
import { Page } from "@/app/Page.tsx";
import { useIssueList, type IssueListItem } from "@/data/issues";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { IconButton } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { StatusIcon } from "@/ui/StatusIcon.tsx";
import { issueSubjectState, pullSubjectState, SubjectStateIcon } from "@/ui/SubjectStatus.tsx";
import { InfiniteList } from "@/ui/VirtualList.tsx";
import styles from "./lists.module.css";

type Kind = "issues" | "pulls";
type ListState = "open" | "closed";

const ROW_ESTIMATE_PX = 84;
const CHECK_ICON_PX = 14;
const EMPTY_TITLES: Readonly<Record<Kind, Record<ListState, MessageKey>>> = {
  issues: { open: "repo.list.noOpenIssues", closed: "repo.list.noClosedIssues" },
  pulls: { open: "repo.list.noOpenPulls", closed: "repo.list.noClosedPulls" },
};

function IssueRow(props: { owner: string; repo: string; kind: Kind; subject: IssueListItem }) {
  const t = useT();
  const { subject, kind } = props;
  const segment = kind === "pulls" ? "pull" : "issues";
  const state =
    kind === "pulls"
      ? pullSubjectState(subject.state, subject.isDraft)
      : issueSubjectState(subject.state === "open" ? "open" : "closed", subject.closedReason);
  return (
    <Link
      href={`/${props.owner}/${props.repo}/${segment}/${String(subject.number)}`}
      className={moduleClass(styles.row)}
    >
      <span className={styles.leading}>
        <SubjectStateIcon state={state} />
      </span>
      <span className={styles.body}>
        <span className={styles.title}>{subject.title}</span>
        <span className={styles.meta}>
          <span>#{subject.number}</span>
          {subject.author ? <span>{subject.author.login}</span> : null}
          <RelativeTime date={subject.updatedAt} />
          {subject.checks ? <StatusIcon status={subject.checks} size={CHECK_ICON_PX} /> : null}
          {subject.comments > 0 ? (
            <span className={styles.inline}>
              <MessageSquare aria-hidden />
              <span aria-hidden>{subject.comments}</span>
              <VisuallyHidden>
                {t("repo.list.comments", { count: subject.comments })}
              </VisuallyHidden>
            </span>
          ) : null}
        </span>
        {subject.labels.length > 0 ? (
          <span className={styles.labels}>
            {subject.labels.map((label) => (
              <span key={label.name} className={styles.label}>
                <span
                  className={styles.swatch}
                  style={{ background: `#${label.color}` }}
                  aria-hidden
                />
                {label.name}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export function IssueList(props: { owner: string; repo: string; kind: Kind }) {
  const t = useT();
  const router = useRouter();
  const { owner, repo, kind } = props;
  const [state, setState] = useState<ListState>("open");
  const list = useIssueList(owner, repo, kind, state);
  const pulls = kind === "pulls";
  const title = t(pulls ? "repo.sections.pulls" : "repo.sections.issues");

  return (
    <Page
      title={title}
      actions={
        <IconButton
          label={t(pulls ? "pull.new.screen" : "repo.list.newIssue")}
          onPress={() => {
            router.history.push(`/${owner}/${repo}/${pulls ? "compare" : "issues/new"}`);
          }}
        >
          <Plus aria-hidden />
        </IconButton>
      }
    >
      <div className={styles.segments}>
        <SegmentedControl
          label={t("repo.list.state")}
          segments={[
            { id: "open", label: t("repo.list.open") },
            { id: "closed", label: t("repo.list.closed") },
          ]}
          selected={state}
          onChange={setState}
        />
      </div>
      <InfiniteList
        separators
        key={state}
        query={list}
        label={title}
        estimateSize={ROW_ESTIMATE_PX}
        getKey={(subject) => subject.number}
        renderItem={(subject) => (
          <IssueRow owner={owner} repo={repo} kind={kind} subject={subject} />
        )}
        empty={
          <EmptyState
            icon={state === "open" ? <CircleCheck /> : pulls ? <GitPullRequest /> : <CircleDot />}
            title={t(EMPTY_TITLES[kind][state])}
            message={t(state === "open" ? "repo.list.noOpenMessage" : "repo.list.noClosedMessage")}
          />
        }
      />
    </Page>
  );
}
