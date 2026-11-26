import {
  memo,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { holdScrollWhile } from "@/ui/hold-scroll.ts";
import { NotFoundScreen } from "../NotFoundScreen.tsx";
import { ScreenBoundary } from "../ScreenBoundary.tsx";
import { EDGE_BACK_WIDTH_PX } from "../platform.ts";
import { useNavigator } from "./context.ts";
import type { StackEntry } from "./navigator.ts";
import { ScreenContext, ScreenTopContext, type ScreenValue } from "./screen.ts";
import { matchScreen, ROOT_ROUTE_ID } from "./screen-route.ts";
import { ScreenSkeleton } from "./ScreenSkeleton.tsx";
import {
  createStackMotion,
  restoreScroll,
  savedScrollTops,
  type StackMotion,
} from "./stack-motion.ts";
import styles from "./StackView.module.css";

const SLOP_PX = 10;
const VELOCITY_WINDOW_MS = 100;
const PROJECTION_MS = 120;
const MAX_VELOCITY_PX_PER_MS = 4;
const MENU_SWIPE_PX = 64;
const MENU_START_WIDTH_PX = 64;

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  offset: number;
  width: number;
  engaged: boolean;
  samples: { x: number; time: number }[];
}

function useScreenRoute(entry: StackEntry) {
  const router = useRouter();
  return useMemo(() => matchScreen(router, entry.href), [router, entry.href]);
}

const Layer = memo(function Layer(props: {
  entry: StackEntry;
  isRoot: boolean;
  isTop: boolean;
  hidden: boolean;
  zIndex: number;
  register: (key: string, element: HTMLDivElement | null) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const { entry, isRoot, isTop, register } = props;

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      scroller.current = node;
      if (node) setMounted(true);
      register(entry.key, node);
    },
    [entry.key, register],
  );

  useLayoutEffect(() => {
    if (isTop && scroller.current) restoreScroll(scroller.current);
  }, [isTop]);

  const route = useScreenRoute(entry);
  const screen = useMemo<ScreenValue>(
    () => ({ href: entry.href, isRoot, match: route.match, scroller }),
    [entry.href, isRoot, route.match],
  );
  const Screen = route.match.routeId === ROOT_ROUTE_ID ? NotFoundScreen : route.component;
  return (
    <div
      ref={attach}
      className={styles.layer}
      data-stack-screen={entry.href}
      data-hidden={props.hidden || undefined}
      inert={!isTop}
      style={{ zIndex: props.zIndex }}
      onScroll={(event) => {
        if (isTop) savedScrollTops.set(event.currentTarget, event.currentTarget.scrollTop);
      }}
    >
      {mounted ? (
        <ScreenContext value={screen}>
          <ScreenTopContext value={isTop}>
            <ScreenBoundary key={route.match.routeId}>
              <Suspense fallback={<ScreenSkeleton />}>{Screen ? <Screen /> : null}</Suspense>
            </ScreenBoundary>
          </ScreenTopContext>
        </ScreenContext>
      ) : null}
    </div>
  );
});

function isRestorable(element: HTMLElement | undefined): element is HTMLElement {
  return element !== undefined && element.isConnected && element.closest("[inert]") === null;
}

// Wait for lazy titles before focusing.
function focusScreen(
  motion: StackMotion,
  origins: Map<string, HTMLElement>,
  key: string,
): (() => void) | undefined {
  const origin = origins.get(key);
  origins.delete(key);
  const layer = motion.layers.get(key);
  // A tap during the pop already moved focus.
  if (layer?.contains(document.activeElement)) return;
  if (isRestorable(origin)) {
    origin.focus({ preventScroll: true });
    return;
  }
  if (!layer) return;
  const focusTitle = () => {
    const title = layer.querySelector<HTMLElement>("h1");
    title?.focus({ preventScroll: true });
    return title !== null;
  };
  if (focusTitle()) return;
  const observer = new MutationObserver(() => {
    if (focusTitle()) observer.disconnect();
  });
  observer.observe(layer, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}

export function StackView(props: {
  entries: readonly StackEntry[];
  leaving: StackEntry | null;
  active: boolean;
  backSwipeEnabled: boolean;
  onOpenMenu?: (() => void) | undefined;
  register: (key: string, element: HTMLDivElement | null) => void;
}) {
  const navigator = useNavigator();
  const [motion] = useState(createStackMotion);
  const drag = useRef<Drag | null>(null);
  const previousTop = useRef<string | null>(null);
  const focusOrigins = useRef(new Map<string, HTMLElement>());
  const focusTarget = useRef<string | null>(null);
  // Cleanup settles layers before the leave effect.
  const interruptedAt = useRef<number | null>(null);
  const { entries, leaving, active, register: registerScroller } = props;
  const top = entries.at(-1);
  const below = entries.at(-2);

  const register = useCallback(
    (key: string, element: HTMLDivElement | null) => {
      if (element) motion.layers.set(key, element);
      else motion.layers.delete(key);
      registerScroller(key, element);
    },
    [motion, registerScroller],
  );

  useLayoutEffect(() => {
    return () => {
      drag.current = null;
      interruptedAt.current = motion.position();
      motion.stop();
      motion.settle(...motion.layers.values());
    };
  }, [active, top?.key, leaving, motion]);

  useLayoutEffect(() => {
    const key = top?.key ?? null;
    const previous = previousTop.current;
    previousTop.current = key;
    if (!active || !key || previous === null || previous === key) return;
    const topLayer = motion.layers.get(key);
    const pushed = !leaving && entries.some((entry) => entry.key === previous);
    const origin = document.activeElement;
    if (pushed && origin instanceof HTMLElement && origin !== document.body) {
      focusOrigins.current.set(previous, origin);
    }
    if (pushed && topLayer) {
      const under = motion.layers.get(previous);
      motion.reveal(under);
      const width = motion.width();
      topLayer.style.pointerEvents = "none";
      motion.paint(topLayer, under, width, width);
      motion.animateTo(topLayer, under, 0, 0, () => {
        motion.settle(topLayer, under);
      });
    }
    focusTarget.current = key;
  }, [top?.key, leaving, active, entries, motion]);

  useLayoutEffect(() => {
    const key = focusTarget.current;
    if (!key || leaving || !active) return;
    focusTarget.current = null;
    return focusScreen(motion, focusOrigins.current, key);
  }, [top?.key, leaving, active, motion]);

  useLayoutEffect(() => {
    if (!leaving) return;
    const leavingLayer = motion.layers.get(leaving.key);
    const under = top ? motion.layers.get(top.key) : undefined;
    const finish = () => {
      motion.settle(under);
      navigator.finishLeaving(leaving.key);
    };
    if (!leavingLayer || !active) {
      finish();
      return;
    }
    motion.reveal(under);
    const width = motion.width();
    motion.paint(leavingLayer, under, interruptedAt.current ?? motion.position(), width);
    interruptedAt.current = null;
    motion.animateTo(leavingLayer, under, width, 0, finish);
  }, [leaving, top, active, navigator, motion]);

  const attachContainer = useCallback(
    (element: HTMLDivElement) => {
      motion.setContainer(element);
      const releaseScroll = holdScrollWhile(element, () => drag.current?.engaged === true);
      return () => {
        releaseScroll();
        motion.setContainer(null);
      };
    },
    [motion],
  );

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!active || leaving || !top) return;
    if (below ? !props.backSwipeEnabled : !props.onOpenMenu) return;
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    if (!event.currentTarget.contains(event.target)) return;
    const fromEdge = event.clientX - event.currentTarget.getBoundingClientRect().left;
    if (fromEdge < 0 || fromEdge > (below ? EDGE_BACK_WIDTH_PX : MENU_START_WIDTH_PX)) return;
    if (!props.backSwipeEnabled && fromEdge <= EDGE_BACK_WIDTH_PX) return;
    if (event.target.closest("input, textarea, [contenteditable=true], [data-handle]")) return;
    for (
      let node = event.target;
      node !== event.currentTarget && node.parentElement;
      node = node.parentElement
    ) {
      if (
        node.scrollLeft > 0 &&
        node.scrollWidth > node.clientWidth &&
        /^(auto|scroll)$/.test(getComputedStyle(node).overflowX)
      )
        return;
    }
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: 0,
      width: motion.width(),
      engaged: false,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId || !top) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.engaged) {
      if ((Math.abs(dy) > SLOP_PX && Math.abs(dy) >= Math.abs(dx)) || dx < -SLOP_PX) {
        drag.current = null;
        return;
      }
      if (dx < SLOP_PX || dx < Math.abs(dy)) return;
      current.engaged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      if (below) {
        motion.stop();
        current.offset = motion.position();
        motion.reveal(motion.layers.get(below.key));
      }
    }
    if (!below) {
      if (dx < MENU_SWIPE_PX) return;
      drag.current = null;
      props.onOpenMenu?.();
      return;
    }
    current.samples = [...current.samples, { x: event.clientX, time: event.timeStamp }].filter(
      (sample) => event.timeStamp - sample.time <= VELOCITY_WINDOW_MS,
    );
    const topLayer = motion.layers.get(top.key);
    if (!topLayer) return;
    const x = Math.min(current.width, Math.max(0, current.offset + dx));
    motion.paint(topLayer, motion.layers.get(below.key), x, current.width);
  }

  function release(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.engaged || !top) return;
    if (!below) return;
    const topLayer = motion.layers.get(top.key);
    const under = motion.layers.get(below.key);
    if (!topLayer) return;
    const first = current.samples[0];
    const elapsed = first ? event.timeStamp - first.time : 0;
    // pointercancel coordinates are unreliable across engines.
    const measured = !cancelled && first && elapsed > 0 ? (event.clientX - first.x) / elapsed : 0;
    const velocity = Math.max(-MAX_VELOCITY_PX_PER_MS, Math.min(MAX_VELOCITY_PX_PER_MS, measured));
    const projected = motion.position() + velocity * PROJECTION_MS;
    const complete = !cancelled && projected > current.width / 2;
    motion.animateTo(topLayer, under, complete ? current.width : 0, velocity, () => {
      if (!complete) {
        motion.settle(topLayer, under);
        return;
      }
      // Settling here paints a blank frame.
      navigator.back({ animated: false });
    });
  }

  const rendered = leaving ? [...entries, leaving] : entries;
  return (
    <div
      ref={attachContainer}
      className={styles.stack}
      data-active={active || undefined}
      inert={!active}
      onDragStartCapture={(event) => {
        if (drag.current) event.preventDefault();
      }}
      onPointerDownCapture={onPointerDown}
      onPointerMoveCapture={onPointerMove}
      onPointerUpCapture={(event) => {
        release(event, false);
      }}
      onPointerCancelCapture={(event) => {
        release(event, true);
      }}
    >
      {rendered.map((entry, index) => {
        const isTop = entry.key === top?.key;
        return (
          <Layer
            key={entry.key}
            entry={entry}
            isRoot={index === 0}
            isTop={isTop && active}
            hidden={!isTop && entry.key !== leaving?.key}
            zIndex={index * 2}
            register={register}
          />
        );
      })}
      <div
        ref={(element) => {
          motion.setScrim(element);
        }}
        className={styles.scrim}
        style={{ zIndex: Math.max(0, (rendered.length - 1) * 2 - 1) }}
        aria-hidden
      />
    </div>
  );
}
