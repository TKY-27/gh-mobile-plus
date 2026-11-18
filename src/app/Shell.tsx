import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, WifiOff } from "lucide-react";
import { useIsRateLimitLow, useIsShowingCachedData, useRateLimit } from "@/data/status";
import { useFormatters, useT } from "@/i18n/index.tsx";
import { Banner } from "@/ui/Banner.tsx";
import { useNow } from "@/ui/RelativeTime.tsx";
import { useAppBadge } from "./badge.ts";
import { useSoftKeyboardOpen } from "./keyboard.ts";
import { isIOSBrowserTab, prefersReducedMotion } from "./platform.ts";
import { useNavigationState, useNavigator } from "./navigation/context.ts";
import { TABS, topOf, type Tab } from "./navigation/navigator.ts";
import { StackView } from "./navigation/StackView.tsx";
import { ShellContext, type ShellActions } from "./shell-context.ts";
import { TabBar } from "./TabBar.tsx";
import styles from "./Shell.module.css";

const CommandPalette = lazy(() => import("./CommandPalette.tsx"));
const AccountSwitcher = lazy(() => import("./AccountSwitcher.tsx"));

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function Shell(props: { unreadCount: number | null }) {
  const t = useT();
  const formatters = useFormatters();
  const navigator = useNavigator();
  const state = useNavigationState();
  const keyboardOpen = useSoftKeyboardOpen();
  const showingCache = useIsShowingCachedData();
  const rateLimitLow = useIsRateLimitLow();
  const rateLimit = useRateLimit();
  const now = useNow();
  const scrollers = useRef(new Map<string, HTMLDivElement>());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  useAppBadge(props.unreadCount);

  const actions = useMemo<ShellActions>(
    () => ({
      unreadCount: props.unreadCount,
      openCommandPalette: () => {
        setPaletteOpen(true);
      },
      openAccountSwitcher: () => {
        setSwitcherOpen(true);
      },
    }),
    [props.unreadCount],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || isTyping(document.activeElement)) return;
      event.preventDefault();
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const reselect = (tab: Tab) => {
    const scroller = scrollers.current.get(topOf(state, tab).key);
    if (scroller && scroller.scrollTop > 0) {
      scroller.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "instant" : "smooth" });
    } else {
      navigator.popToRoot();
    }
  };

  const register = useCallback((key: string, element: HTMLDivElement | null) => {
    if (element) scrollers.current.set(key, element);
    else scrollers.current.delete(key);
  }, []);

  return (
    <ShellContext value={actions}>
      <div className={styles.shell}>
        <main className={styles.stacks}>
          {TABS.filter((tab) => state.visited.includes(tab)).map((tab) => (
            <StackView
              key={tab}
              entries={state.stacks[tab]}
              leaving={state.leaving?.tab === tab ? state.leaving.entry : null}
              active={state.activeTab === tab}
              swipeEnabled={!isIOSBrowserTab}
              register={register}
            />
          ))}
        </main>
        <div className={styles.banners} data-keyboard-open={keyboardOpen || undefined}>
          {showingCache ? <Banner icon={<WifiOff />}>{t("app.banner.offline")}</Banner> : null}
          {rateLimitLow && rateLimit ? (
            <Banner icon={<Gauge />} tone="warning">
              {t("app.banner.rateLimit", {
                time: formatters.relativeTime(rateLimit.resetAt, now),
              })}
            </Banner>
          ) : null}
        </div>
        <TabBar
          active={state.activeTab}
          hidden={keyboardOpen}
          onSelect={navigator.selectTab}
          onReselect={reselect}
          onAccountLongPress={() => {
            setSwitcherOpen(true);
          }}
        />
        <Suspense fallback={null}>
          {paletteOpen ? <CommandPalette isOpen onOpenChange={setPaletteOpen} /> : null}
          {switcherOpen ? <AccountSwitcher isOpen onOpenChange={setSwitcherOpen} /> : null}
        </Suspense>
      </div>
    </ShellContext>
  );
}
