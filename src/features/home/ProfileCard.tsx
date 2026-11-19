import { useLayoutEffect, useMemo, useRef } from "react";
import { CalendarDays } from "lucide-react";
import { Link } from "react-aria-components/Link";
import type { ViewerSummary } from "@/data/home";
import { useLanguage, useT } from "@/i18n/index.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import styles from "./ProfileCard.module.css";

const LEVELS = [0, 1, 2, 3, 4] as const;

export function ProfileIdentity(props: { login: string; name: string | null }) {
  return (
    <Link href={`/${props.login}`} className={moduleClass(styles.identity)}>
      <span className={styles.names}>
        <span className={styles.name}>{props.name || props.login}</span>
        <span className={styles.login}>@{props.login}</span>
      </span>
    </Link>
  );
}

export function ContributionGraph(props: { contributions: ViewerSummary["contributions"] }) {
  const t = useT();
  const language = useLanguage();
  const scroller = useRef<HTMLDivElement | null>(null);
  const { weeks, total } = props.contributions;
  const month = useMemo(
    () => new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" }),
    [language],
  );

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks.length]);

  return (
    <section className={styles.graph} aria-label={t("home.profile.calendarTitle")}>
      <div className={styles.graphHeader}>
        <h2>
          <CalendarDays aria-hidden />
          {t("home.profile.calendarTitle")}
        </h2>
        <span>{t("home.profile.yearTotal", { count: total })}</span>
      </div>
      <div
        ref={scroller}
        className={styles.graphScroller}
        tabIndex={0}
        role="group"
        aria-label={t("home.profile.contributionGraph")}
      >
        <div
          className={styles.weeks}
          role="img"
          aria-label={t("home.profile.contributions", { count: total })}
        >
          {weeks.map((week) => {
            const firstDate = week[0]?.date;
            if (!firstDate) return null;
            const start = new Date(firstDate + "T00:00:00Z");
            return (
              <div className={styles.week} key={firstDate} aria-hidden>
                {start.getUTCDate() <= 7 ? (
                  <span className={styles.month}>{month.format(start)}</span>
                ) : null}
                {week.map((day) => (
                  <span
                    key={day.date}
                    className={styles.cell}
                    style={{ gridRow: new Date(day.date + "T00:00:00Z").getUTCDay() + 2 }}
                    data-level={day.level}
                    title={t("home.profile.dayTotal", { date: day.date, count: day.count })}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.legend} aria-hidden>
        <span>{t("home.profile.less")}</span>
        {LEVELS.map((level) => (
          <i key={level} className={styles.cell} data-level={level} />
        ))}
        <span>{t("home.profile.more")}</span>
      </div>
    </section>
  );
}
