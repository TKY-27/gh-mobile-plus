import { useEffect, useRef } from "react";
import {
  BookMarked,
  GitPullRequest,
  House,
  Search,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { useT, type MessageKey } from "@/i18n/index.tsx";
import { useActiveAccount } from "@/data/session";
import { Avatar } from "@/ui/Avatar.tsx";
import { TABS, type Tab } from "./navigation/navigator.ts";
import { moduleClass } from "@/ui/module-class.ts";
import styles from "./TabBar.module.css";

const LONG_PRESS_MS = 500;
const ACTIVE_STROKE = 2.4;
const ACTIVE_OUTLINE_STROKE = 3;
const IDLE_STROKE = 1.8;
// A filled search glyph becomes a disc.
const FILLED_WHEN_ACTIVE: ReadonlySet<Tab> = new Set(["home", "repositories", "work"]);

const TAB_ICONS: Readonly<Record<Tab, LucideIcon>> = {
  home: House,
  repositories: BookMarked,
  work: GitPullRequest,
  search: Search,
  account: UserRound,
};

const TAB_LABELS: Readonly<Record<Tab, MessageKey>> = {
  home: "app.tabs.home",
  work: "app.tabs.work",
  repositories: "app.tabs.repositories",
  search: "app.tabs.search",
  account: "app.tabs.account",
};

function activeStroke(active: boolean, tab: Tab): number {
  if (!active) return IDLE_STROKE;
  return FILLED_WHEN_ACTIVE.has(tab) ? ACTIVE_STROKE : ACTIVE_OUTLINE_STROKE;
}

export function TabBar(props: {
  active: Tab;
  hidden: boolean;
  onSelect: (tab: Tab) => void;
  onReselect: (tab: Tab) => void;
  onAccountLongPress: () => void;
}) {
  const t = useT();
  const account = useActiveAccount();
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
        "--measured-tab-height",
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
      <div className={styles.brand} aria-hidden>
        <img src="/icon.svg" alt="" width={28} height={28} />
        {t("app.title")}
      </div>
      {TABS.map((tab) => {
        const Icon = TAB_ICONS[tab];
        const label = t(TAB_LABELS[tab]);
        return (
          <AriaButton
            key={tab}
            className={moduleClass(styles.tab)}
            {...(props.active === tab ? { "aria-current": "page" as const } : {})}
            aria-label={label}
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
              if (tab === "account" && longPressed.current) {
                longPressed.current = false;
                return;
              }
              if (props.active === tab) props.onReselect(tab);
              else props.onSelect(tab);
            }}
          >
            <span className={styles.icon}>
              {tab === "account" ? (
                <Avatar src={account.avatarUrl} name={account.login} size={24} />
              ) : (
                <Icon
                  aria-hidden
                  strokeWidth={activeStroke(props.active === tab, tab)}
                  fill={
                    props.active === tab && FILLED_WHEN_ACTIVE.has(tab) ? "currentColor" : "none"
                  }
                />
              )}
            </span>
            <span className={styles.label}>{label}</span>
          </AriaButton>
        );
      })}
    </nav>
  );
}
