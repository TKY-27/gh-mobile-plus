import { useLayoutEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-aria-components/Link";
import type { ViewerSummary } from "@/data/home";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { Skeleton } from "@/ui/Skeleton.tsx";
import styles from "./ProfileCard.module.css";

const AVATAR_PX = 56;
const CELL_PX = 11;
const GAP_PX = 3;
const STEP_PX = CELL_PX + GAP_PX;
const DAYS_PER_WEEK = 7;

function ContributionGraph(props: { contributions: ViewerSummary["contributions"] }) {
  const t = useT();
  const scroller = useRef<HTMLDivElement | null>(null);
  const { weeks, total } = props.contributions;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks.length]);

  const label = t("home.profile.contributions", { count: total });
  return (
    <div className={styles.graph}>
      <p className={styles.graphCaption}>{label}</p>
      <div
        ref={scroller}
        className={styles.graphScroller}
        tabIndex={0}
        role="group"
        aria-label={t("home.profile.contributionGraph")}
      >
        <svg
          width={weeks.length * STEP_PX - GAP_PX}
          height={DAYS_PER_WEEK * STEP_PX - GAP_PX}
          role="img"
          aria-label={label}
        >
          {weeks.map((week, column) =>
            week.map((day) => (
              <rect
                key={day.date}
                x={column * STEP_PX}
                y={new Date(`${day.date}T00:00:00Z`).getUTCDay() * STEP_PX}
                width={CELL_PX}
                height={CELL_PX}
                rx={2}
                className={styles.cell}
                data-level={day.level}
              />
            )),
          )}
        </svg>
      </div>
    </div>
  );
}

export function ProfileCardSkeleton() {
  return (
    <div className={styles.card} aria-hidden>
      <div className={styles.summary}>
        <Skeleton width={`${String(AVATAR_PX)}px`} height={`${String(AVATAR_PX)}px`} round />
        <div className={styles.skeletonText}>
          <Skeleton width="60%" height="1.125rem" />
          <Skeleton width="40%" height="0.875rem" />
        </div>
      </div>
      <Skeleton width="100%" height={`${String(DAYS_PER_WEEK * STEP_PX)}px`} />
    </div>
  );
}

export function ProfileCard(props: { viewer: ViewerSummary }) {
  const t = useT();
  const formatters = useFormatters();
  const { viewer } = props;
  return (
    <section className={styles.card} aria-label={t("home.profile.title")}>
      <Link href={`/${viewer.login}`} className={moduleClass(styles.summary)}>
        <Avatar src={viewer.avatarUrl} name={viewer.login} size={AVATAR_PX} />
        <span className={styles.identity}>
          <span className={styles.name}>{viewer.name ?? viewer.login}</span>
          {viewer.name ? <span className={styles.login}>{viewer.login}</span> : null}
          <span className={styles.counts}>
            {t("home.profile.followers", {
              count: viewer.followers,
              formatted: formatters.compactNumber(viewer.followers),
            })}
            <span aria-hidden> · </span>
            {t("home.profile.following", {
              count: viewer.following,
              formatted: formatters.compactNumber(viewer.following),
            })}
          </span>
        </span>
        <ChevronRight className={styles.chevron} aria-hidden />
      </Link>
      <ContributionGraph contributions={viewer.contributions} />
    </section>
  );
}
