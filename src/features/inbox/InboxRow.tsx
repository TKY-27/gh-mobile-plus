import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  Bell,
  Check,
  CircleCheck,
  CircleDot,
  Ellipsis,
  GitCommitHorizontal,
  GitPullRequest,
  MailOpen,
  MessagesSquare,
  ShieldAlert,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { runSpring, type SpringRun } from "@/app/navigation/spring.ts";
import { prefersReducedMotion } from "@/app/platform.ts";
import type { InboxThread, NotificationSubjectType } from "@/data/inbox";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { IconButton } from "@/ui/Button.tsx";
import { Checkbox } from "@/ui/Checkbox.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { actionFor, commitDistance, rubberBand, shouldCommit, type SwipeAction } from "./swipe.ts";
import styles from "./InboxRow.module.css";

const LONG_PRESS_MS = 500;
const SLOP_PX = 10;
const VELOCITY_WINDOW_MS = 100;
const MAX_VELOCITY_PX_PER_MS = 4;

const SUBJECT_ICONS: Readonly<Record<NotificationSubjectType, LucideIcon>> = {
  Issue: CircleDot,
  PullRequest: GitPullRequest,
  Release: Tag,
  Commit: GitCommitHorizontal,
  Discussion: MessagesSquare,
  CheckSuite: CircleCheck,
  RepositoryVulnerabilityAlert: ShieldAlert,
  Other: Bell,
};

const SUBJECT_LABELS: Readonly<Record<NotificationSubjectType, MessageKey>> = {
  Issue: "inbox.subject.issue",
  PullRequest: "inbox.subject.pullRequest",
  Release: "inbox.subject.release",
  Commit: "inbox.subject.commit",
  Discussion: "inbox.subject.discussion",
  CheckSuite: "inbox.subject.checkSuite",
  RepositoryVulnerabilityAlert: "inbox.subject.vulnerability",
  Other: "inbox.subject.other",
};

const REASONS: Readonly<Record<string, MessageKey>> = {
  approval_requested: "inbox.reason.approvalRequested",
  assign: "inbox.reason.assign",
  author: "inbox.reason.author",
  ci_activity: "inbox.reason.ciActivity",
  comment: "inbox.reason.comment",
  invitation: "inbox.reason.invitation",
  manual: "inbox.reason.manual",
  member_feature_requested: "inbox.reason.memberFeatureRequested",
  mention: "inbox.reason.mention",
  review_requested: "inbox.reason.reviewRequested",
  security_advisory_credit: "inbox.reason.securityAdvisoryCredit",
  security_alert: "inbox.reason.securityAlert",
  state_change: "inbox.reason.stateChange",
  subscribed: "inbox.reason.subscribed",
  team_mention: "inbox.reason.teamMention",
};

export const THREAD_ROW_ESTIMATE_PX = 88;

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  engaged: boolean;
  width: number;
  samples: { x: number; time: number }[];
}

function reasonKey(reason: string): MessageKey {
  return REASONS[reason] ?? "inbox.reason.other";
}

function ThreadContent(props: { thread: InboxThread }) {
  const t = useT();
  const { thread } = props;
  const Icon = SUBJECT_ICONS[thread.subjectType];
  return (
    <>
      <span className={styles.status}>
        {thread.unread ? (
          <span className={styles.dot} role="img" aria-label={t("inbox.unread")} />
        ) : null}
        <Icon
          className={styles.icon}
          role="img"
          aria-label={t(SUBJECT_LABELS[thread.subjectType])}
        />
      </span>
      <span className={styles.text}>
        <span className={styles.header}>
          <span className={styles.repo}>
            {thread.repo.owner}/{thread.repo.name}
          </span>
          <RelativeTime date={thread.updatedAt} />
        </span>
        <span className={styles.title}>{thread.title}</span>
        <span className={styles.reason}>{t(reasonKey(thread.reason))}</span>
      </span>
    </>
  );
}

export function InboxRow(props: {
  thread: InboxThread;
  selecting: boolean;
  selected: boolean;
  removesOnRead: boolean;
  onSelectedChange: (selected: boolean) => void;
  onOpen: () => void;
  onAction: (action: SwipeAction) => void;
  onShowActions: () => void;
}) {
  const t = useT();
  const { thread } = props;
  const row = useRef<HTMLDivElement | null>(null);
  const surface = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const offset = useRef(0);
  const settle = useRef<SpringRun | null>(null);
  const longPress = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const menuShown = useRef(false);

  useEffect(
    () => () => {
      settle.current?.cancel();
      window.clearTimeout(longPress.current);
    },
    [],
  );

  const canSwipe = (action: SwipeAction) => action === "done" || thread.unread;

  const paint = (x: number, threshold: number) => {
    offset.current = x;
    const action = actionFor(x);
    if (surface.current) surface.current.style.transform = x ? `translateX(${String(x)}px)` : "";
    const element = row.current;
    if (!element) return;
    element.dataset.swipe = action ?? "";
    element.toggleAttribute(
      "data-armed",
      action !== null && canSwipe(action) && Math.abs(x) >= threshold,
    );
  };

  const animateTo = (target: number, velocity: number, threshold: number, done: () => void) => {
    settle.current?.cancel();
    if (prefersReducedMotion()) {
      paint(target, threshold);
      done();
      return;
    }
    settle.current = runSpring(
      offset.current,
      target,
      velocity,
      (x) => {
        paint(x, threshold);
      },
      done,
    );
  };

  const cancelLongPress = () => {
    window.clearTimeout(longPress.current);
  };

  const showActions = () => {
    cancelLongPress();
    drag.current = null;
    suppressClick.current = true;
    menuShown.current = true;
    props.onShowActions();
  };

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    menuShown.current = false;
    if (props.selecting || event.button !== 0 || !event.isPrimary) return;
    settle.current?.cancel();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX - offset.current,
      startY: event.clientY,
      engaged: false,
      width: event.currentTarget.offsetWidth,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    };
    longPress.current = window.setTimeout(showActions, LONG_PRESS_MS);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.engaged) {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
      cancelLongPress();
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null;
        return;
      }
      current.engaged = true;
      row.current?.toggleAttribute("data-dragging", true);
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    current.samples = [...current.samples, { x: event.clientX, time: event.timeStamp }].filter(
      (sample) => event.timeStamp - sample.time <= VELOCITY_WINDOW_MS,
    );
    const threshold = commitDistance(current.width);
    const action = actionFor(dx);
    const free = action && canSwipe(action) ? threshold : 0;
    paint(rubberBand(dx, free, current.width), threshold);
  }

  function release(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    cancelLongPress();
    row.current?.toggleAttribute("data-dragging", false);
    const current = drag.current;
    drag.current = null;
    if (current?.pointerId !== event.pointerId || !current.engaged) return;
    const threshold = commitDistance(current.width);
    const first = current.samples[0];
    const elapsed = first ? event.timeStamp - first.time : 0;
    const measured = first && elapsed > 0 ? (event.clientX - first.x) / elapsed : 0;
    const velocity = Math.max(-MAX_VELOCITY_PX_PER_MS, Math.min(MAX_VELOCITY_PX_PER_MS, measured));
    const action = actionFor(offset.current);
    const commit =
      !cancelled &&
      action !== null &&
      canSwipe(action) &&
      shouldCommit(offset.current, velocity, threshold);
    if (!commit) {
      animateTo(0, velocity, threshold, () => undefined);
      return;
    }
    const leaves = action === "done" || props.removesOnRead;
    if (!leaves) {
      props.onAction(action);
      animateTo(0, velocity, threshold, () => undefined);
      return;
    }
    const exit = Math.sign(offset.current) * current.width;
    animateTo(exit, velocity, threshold, () => {
      props.onAction(action);
    });
  }

  if (props.selecting) {
    return (
      <div className={styles.row} data-unread={thread.unread || undefined}>
        <div className={styles.surface}>
          <Checkbox isSelected={props.selected} onChange={props.onSelectedChange}>
            <span className={styles.selectable}>
              <ThreadContent thread={thread} />
            </span>
          </Checkbox>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={row}
      className={styles.row}
      data-unread={thread.unread || undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!menuShown.current) showActions();
      }}
    >
      <div className={styles.underlay} aria-hidden>
        <span className={styles.doneSide}>
          <Check />
          {t("inbox.action.done")}
        </span>
        <span className={styles.readSide}>
          {t("inbox.action.read")}
          <MailOpen />
        </span>
      </div>
      <div
        ref={surface}
        className={styles.surface}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => {
          release(event, false);
        }}
        onPointerCancel={(event) => {
          release(event, true);
        }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button type="button" className={styles.open} onClick={props.onOpen}>
          <ThreadContent thread={thread} />
        </button>
        <span className={styles.more}>
          <IconButton
            label={t("inbox.actionsFor", { title: thread.title })}
            onPress={props.onShowActions}
          >
            <Ellipsis aria-hidden />
          </IconButton>
        </span>
      </div>
    </div>
  );
}
