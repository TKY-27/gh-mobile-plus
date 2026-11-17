import { useEffect, useRef } from "react";
import { Briefcase, House, Inbox, Search, UserRound, type LucideIcon } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { useFormatters, useT, type MessageKey } from "@/i18n/index.tsx";
import { TABS, type Tab } from "./navigation/navigator.ts";
import { moduleClass } from "@/ui/module-class.ts";
import styles from "./TabBar.module.css";

const LONG_PRESS_MS = 500;
const BADGE_CAP = 99;
const ACTIVE_STROKE = 2.4;
const IDLE_STROKE = 1.8;

const TAB_ICONS: Readonly<Record<Tab, LucideIcon>> = {
  home: House,
  work: Briefcase,
  inbox: Inbox,
  search: Search,
  account: UserRound,
};

const TAB_LABELS: Readonly<Record<Tab, MessageKey>> = {
  home: "app.tabs.home",
  work: "app.tabs.work",
  inbox: "app.tabs.inbox",
  search: "app.tabs.search",
  account: "app.tabs.account",
};

export function TabBar(props: {
  active: Tab;
  hidden: boolean;
  unreadCount: number | null;
  onSelect: (tab: Tab) => void;
  onReselect: (tab: Tab) => void;
  onAccountLongPress: () => void;
}) {
  const t = useT();
  const formatters = useFormatters();
  const longPressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  const bar = useRef<HTMLElement | null>(null);

  // Overlays must clear Dynamic Type growth.
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      document.documentElement.style.setProperty(
        "--tab-bar-height",
        `${String(entry.contentRect.height)}px`,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const cancelLongPress = () => {
    window.clearTimeout(longPressTimer.current);
  };

  return (
    <nav
      ref={bar}
      className={styles.bar}
      aria-label={t("app.tabs.label")}
      data-hidden={props.hidden || undefined}
    >
      {TABS.map((tab) => {
        const Icon = TAB_ICONS[tab];
        const unread = tab === "inbox" && props.unreadCount ? props.unreadCount : 0;
        const label = t(TAB_LABELS[tab]);
        return (
          <AriaButton
            key={tab}
            className={moduleClass(styles.tab)}
            {...(props.active === tab ? { "aria-current": "page" as const } : {})}
            aria-label={unread > 0 ? t("app.tabs.inboxUnread", { label, count: unread }) : label}
            data-tab={tab}
            onPressStart={() => {
              if (tab !== "account") return;
              longPressed.current = false;
              longPressTimer.current = window.setTimeout(() => {
                longPressed.current = true;
                props.onAccountLongPress();
              }, LONG_PRESS_MS);
            }}
            onPressEnd={cancelLongPress}
            onPress={() => {
              if (longPressed.current) {
                longPressed.current = false;
                return;
              }
              if (props.active === tab) props.onReselect(tab);
              else props.onSelect(tab);
            }}
          >
            <span className={styles.icon}>
              <Icon aria-hidden strokeWidth={props.active === tab ? ACTIVE_STROKE : IDLE_STROKE} />
              {unread > 0 ? (
                <span className={styles.badge} aria-hidden>
                  {unread > BADGE_CAP
                    ? `${formatters.number(BADGE_CAP)}+`
                    : formatters.number(unread)}
                </span>
              ) : null}
            </span>
            <span className={styles.label}>{label}</span>
          </AriaButton>
        );
      })}
    </nav>
  );
}
