import { useEffect, useRef, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { useScreen } from "@/app/navigation/screen.ts";
import { useT } from "@/i18n/index.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import styles from "./PullToRefresh.module.css";

const TRIGGER_PX = 72;
const SLOP_PX = 8;
const RESISTANCE = 0.5;

/** Touch-only; pair with a Refresh action. */
export function PullToRefresh(props: {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const { scroller, isTop } = useScreen();
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
      element.style.setProperty("--pull", String(pull * RESISTANCE));
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
        {refreshing ? (
          <Spinner size="small" label={t("home.refreshing")} />
        ) : (
          <span className={styles.arrow} aria-hidden>
            <ArrowDown />
          </span>
        )}
      </div>
      {props.children}
    </>
  );
}
