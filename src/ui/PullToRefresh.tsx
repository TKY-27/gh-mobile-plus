import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { useIsTopScreen, useScreen } from "@/app/navigation/screen.ts";
import { useT } from "@/i18n/index.tsx";
import { Spinner } from "./Spinner.tsx";
import styles from "./PullToRefresh.module.css";

const TRIGGER_PX = 72;
const SLOP_PX = 8;
const RESISTANCE = 0.5;
const MAX_PULL_PX = TRIGGER_PX * 1.5;

export function useRefreshAction(run: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    void run().finally(() => {
      setRefreshing(false);
    });
  }, [run]);
  return { refreshing, refresh };
}

/** Touch-only; pair with a Refresh action. */
export function PullToRefresh(props: {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { scroller } = useScreen();
  const isTop = useIsTopScreen();
  const indicator = useRef<HTMLDivElement | null>(null);
  const { refreshing, onRefresh } = props;

  useEffect(() => {
    const root = scroller.current;
    const element = indicator.current;
    if (!root || !element || !isTop || refreshing) return;
    let start: { x: number; y: number } | null = null;
    let pulling = false;
    let distance = 0;

    const paint = (pull: number) => {
      const progress = Math.min(1, pull / TRIGGER_PX);
      // iOS rubber-banding already moves the content.
      const travel = root.scrollTop < 0 ? 0 : Math.min(pull, MAX_PULL_PX) * RESISTANCE;
      element.style.setProperty("--pull", String(travel));
      element.style.setProperty("--progress", String(progress));
      element.toggleAttribute("data-armed", progress >= 1);
      element.toggleAttribute("data-pulling", pull > 0);
    };
    const reset = () => {
      start = null;
      pulling = false;
      distance = 0;
      paint(0);
    };
    const onStart = (event: TouchEvent) => {
      reset();
      const touch = event.touches[0];
      if (event.touches.length === 1 && root.scrollTop <= 0 && touch) {
        start = { x: touch.clientX, y: touch.clientY };
      }
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!pulling) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= SLOP_PX) return;
        if (dy <= Math.abs(dx) || root.scrollTop > 0) {
          reset();
          return;
        }
        pulling = true;
      }
      distance = Math.max(0, dy - SLOP_PX);
      paint(distance);
    };
    const onEnd = () => {
      const refresh = pulling && distance >= TRIGGER_PX;
      reset();
      if (refresh) onRefresh();
    };
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: true });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", reset);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", reset);
      reset();
    };
  }, [scroller, isTop, refreshing, onRefresh]);

  return (
    <>
      <div ref={indicator} className={styles.indicator} data-refreshing={refreshing || undefined}>
        <span className={styles.bubble}>
          {refreshing ? (
            <Spinner size="small" label={t("common.refreshing")} />
          ) : (
            <ArrowDown aria-hidden />
          )}
        </span>
      </div>
      {props.children}
    </>
  );
}
