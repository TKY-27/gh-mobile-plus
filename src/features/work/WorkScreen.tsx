import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { useScreenSearch } from "@/app/navigation/screen.ts";
import { workRoute } from "@/app/router.ts";
import { GitPullRequest, RotateCw } from "lucide-react";
import { Page } from "@/app/Page.tsx";
import type { ChecksState, ReviewDecision } from "@/data/types";
import { useWorkQueue, type WorkItem, type WorkSegment } from "@/data/work";
import { SkeletonRows } from "@/ui/SkeletonRows.tsx";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { IconButton } from "@/ui/Button.tsx";
import { EmptyState } from "@/ui/EmptyState.tsx";
import { PullToRefresh, useRefreshAction } from "@/ui/PullToRefresh.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { ListRow, ListSection } from "@/ui/ListRow.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SegmentedControl } from "@/ui/SegmentedControl.tsx";
import { StatusIcon, type Status } from "@/ui/StatusIcon.tsx";
import { pullSubjectState, SubjectStateIcon } from "@/ui/SubjectStatus.tsx";
import styles from "./WorkScreen.module.css";

const SKELETON_ROWS = 6;

const SEGMENTS: readonly WorkSegment[] = ["reviewRequested", "myPrs", "assigned", "ciFailing"];

const SEGMENT_TEXT: Readonly<
  Record<WorkSegment, { label: MessageKey; emptyTitle: MessageKey; emptyMessage: MessageKey }>
> = {
  reviewRequested: {
    label: "work.segment.reviewRequested",
    emptyTitle: "work.empty.reviewRequested.title",
    emptyMessage: "work.empty.reviewRequested.message",
  },
  myPrs: {
    label: "work.segment.myPrs",
    emptyTitle: "work.empty.myPrs.title",
    emptyMessage: "work.empty.myPrs.message",
  },
  assigned: {
    label: "work.segment.assigned",
    emptyTitle: "work.empty.assigned.title",
    emptyMessage: "work.empty.assigned.message",
  },
  ciFailing: {
    label: "work.segment.ciFailing",
    emptyTitle: "work.empty.ciFailing.title",
    emptyMessage: "work.empty.ciFailing.message",
  },
};

const REVIEW_TEXT: Readonly<Record<NonNullable<ReviewDecision>, MessageKey>> = {
  approved: "work.review.approved",
  changesRequested: "work.review.changesRequested",
  reviewRequired: "work.review.reviewRequired",
};

const REVIEW_STATUS: Readonly<Record<NonNullable<ReviewDecision>, Status>> = {
  approved: "success",
  changesRequested: "failure",
  reviewRequired: "pending",
};

const CHECKS_TEXT: Readonly<Record<NonNullable<ChecksState>, MessageKey>> = {
  success: "work.checks.success",
  failure: "work.checks.failure",
  pending: "work.checks.pending",
};

function subjectPath(subject: WorkItem): string {
  const kind = subject.kind === "pullRequest" ? "pull" : "issues";
  return `/${subject.repo.owner}/${subject.repo.name}/${kind}/${String(subject.number)}`;
}

function subjectKey(subject: WorkItem): string {
  return `${subject.repo.owner}/${subject.repo.name}#${String(subject.number)}`;
}

function WorkRow(props: { subject: WorkItem }) {
  const t = useT();
  const { subject } = props;
  const state =
    subject.kind === "pullRequest" ? pullSubjectState("open", subject.isDraft) : "issueOpen";
  return (
    <ListRow
      href={subjectPath(subject)}
      leading={
        <span className={styles.kind}>
          <SubjectStateIcon state={state} />
        </span>
      }
      title={<span className={styles.title}>{subject.title}</span>}
      subtitle={
        <span className={styles.meta}>
          <span className={styles.repo}>
            {subject.repo.owner}/{subject.repo.name} #{subject.number}
          </span>
          <RelativeTime date={subject.updatedAt} />
          {subject.reviewDecision ? (
            <span className={styles.review} data-review={subject.reviewDecision}>
              <span aria-hidden>
                <StatusIcon status={REVIEW_STATUS[subject.reviewDecision]} size={14} />
              </span>
              {t(REVIEW_TEXT[subject.reviewDecision])}
            </span>
          ) : null}
        </span>
      }
      trailing={
        subject.checks ? (
          <span className={styles.checks} role="img" aria-label={t(CHECKS_TEXT[subject.checks])}>
            <StatusIcon status={subject.checks} size={20} />
          </span>
        ) : null
      }
    />
  );
}

export default function WorkScreen() {
  const t = useT();
  const formatters = useFormatters();
  const queue = useWorkQueue();
  const router = useRouter();
  const search: Readonly<Record<string, unknown>> = useScreenSearch(workRoute);
  const segment = SEGMENTS.find((id) => id === search.segment) ?? "reviewRequested";
  const current = queue.data?.[segment];
  const text = SEGMENT_TEXT[segment];
  const { refetch } = queue;
  const { refreshing, refresh } = useRefreshAction(useCallback(() => refetch(), [refetch]));

  let body;
  if (queue.isPending) body = <SkeletonRows rows={SKELETON_ROWS} />;
  else if (queue.isError) {
    body = <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />;
  } else if (!current || current.items.length === 0) {
    body = (
      <EmptyState
        icon={<GitPullRequest />}
        title={t(text.emptyTitle)}
        message={t(text.emptyMessage)}
      />
    );
  } else {
    const hidden = current.count - current.items.length;
    body = (
      <ListSection
        footer={
          hidden > 0
            ? t("work.more", { shown: current.items.length, count: current.count })
            : undefined
        }
      >
        {current.items.map((subject) => (
          <WorkRow key={subjectKey(subject)} subject={subject} />
        ))}
      </ListSection>
    );
  }

  return (
    <Page
      title={t("app.tabs.work")}
      largeTitle
      actions={
        <IconButton label={t("work.refresh")} onPress={refresh} isPending={refreshing}>
          <RotateCw aria-hidden />
        </IconButton>
      }
    >
      <PullToRefresh refreshing={refreshing} onRefresh={refresh}>
        <div className={styles.segments}>
          <SegmentedControl
            label={t("work.segment.label")}
            segments={SEGMENTS.map((id) => {
              const count = queue.data?.[id].count;
              return {
                id,
                label: t(SEGMENT_TEXT[id].label),
                ...(count === undefined ? {} : { count: formatters.compactNumber(count) }),
              };
            })}
            selected={segment}
            onChange={(next) => {
              router.history.replace(`/pulls?segment=${next}`);
            }}
          />
        </div>
        <div aria-busy={queue.isFetching || undefined}>{body}</div>
      </PullToRefresh>
    </Page>
  );
}
