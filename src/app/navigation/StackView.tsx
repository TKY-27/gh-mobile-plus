import {
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "@tanstack/react-router";
import { NotFoundScreen } from "../NotFoundScreen.tsx";
import { ScreenBoundary } from "../ScreenBoundary.tsx";
import { useNavigator } from "./context.ts";
import type { StackEntry } from "./navigator.ts";
import { ScreenContext, type ScreenValue } from "./screen.ts";
import { matchScreen, ROOT_ROUTE_ID } from "./screen-route.ts";
import { ScreenSkeleton } from "./ScreenSkeleton.tsx";
import { createStackMotion, type StackMotion } from "./stack-motion.ts";
import styles from "./StackView.module.css";

const EDGE_WIDTH_PX = 20;
const SLOP_PX = 10;
const VELOCITY_WINDOW_MS = 100;
const PROJECTION_MS = 120;
const MAX_VELOCITY_PX_PER_MS = 4;

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  offset: number;
  engaged: boolean;
  samples: { x: number; time: number }[];
}

function useScreenRoute(entry: StackEntry) {
  const router = useRouter();
  return useMemo(() => matchScreen(router, entry.href), [router, entry.href]);
}

function Layer(props: {
  entry: StackEntry;
  isRoot: boolean;
  isTop: boolean;
  visible: boolean;
  hidden: boolean;
  zIndex: number;
  register: (key: string, element: HTMLDivElement | null) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const savedScroll = useRef(0);
  const { entry, isRoot, isTop, visible } = props;

  // WebKit can lose offsets when hidden.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (visible && element && element.scrollTop !== savedScroll.current) {
      element.scrollTop = savedScroll.current;
    }
  }, [visible]);

  const route = useScreenRoute(entry);
  const screen = useMemo<ScreenValue>(
    () => ({ href: entry.href, isRoot, isTop, match: route.match, scroller }),
    [entry.href, isRoot, isTop, route.match],
  );
  const Screen = route.match.routeId === ROOT_ROUTE_ID ? NotFoundScreen : route.component;
  return (
    <div
      ref={(element) => {
        scroller.current = element;
        props.register(entry.key, element);
      }}
      className={styles.layer}
      data-stack-screen={entry.href}
      data-hidden={props.hidden || undefined}
      inert={!isTop}
      style={{ zIndex: props.zIndex }}
      onScroll={(event) => {
        if (visible) savedScroll.current = event.currentTarget.scrollTop;
      }}
    >
      <ScreenContext value={screen}>
        <ScreenBoundary>
          <Suspense fallback={<ScreenSkeleton />}>{Screen ? <Screen /> : null}</Suspense>
        </ScreenBoundary>
      </ScreenContext>
    </div>
  );
}

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
  if (isRestorable(origin)) {
    origin.focus({ preventScroll: true });
    return;
  }
  const layer = motion.layers.get(key);
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
  swipeEnabled: boolean;
  register: (key: string, element: HTMLDivElement | null) => void;
}) {
  const navigator = useNavigator();
  const [motion] = useState(createStackMotion);
  const drag = useRef<Drag | null>(null);
  const previousTop = useRef<string | null>(null);
  const focusOrigins = useRef(new Map<string, HTMLElement>());
  const focusTarget = useRef<string | null>(null);
  const { entries, leaving, active } = props;
  const top = entries.at(-1);
  const below = entries.at(-2);

  const register = (key: string, element: HTMLDivElement | null) => {
    if (element) motion.layers.set(key, element);
    else motion.layers.delete(key);
    props.register(key, element);
  };

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
      motion.paint(topLayer, under, motion.width());
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
    motion.paint(leavingLayer, under, motion.position());
    motion.animateTo(leavingLayer, under, motion.width(), 0, finish);
  }, [leaving, top, active, navigator, motion]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!props.swipeEnabled || !below || !top || event.button !== 0 || !event.isPrimary) return;
    const fromEdge = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const interrupting = motion.isAnimating() && motion.position() > 0 && !leaving;
    if (fromEdge > EDGE_WIDTH_PX && !interrupting) return;
    motion.stop();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: motion.position(),
      engaged: interrupting,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    };
    if (interrupting) event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId || !top || !below) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.engaged) {
      if (Math.abs(dy) > SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      if (dx < SLOP_PX || dx < Math.abs(dy)) return;
      current.engaged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      motion.reveal(motion.layers.get(below.key));
    }
    current.samples = [...current.samples, { x: event.clientX, time: event.timeStamp }].filter(
      (sample) => event.timeStamp - sample.time <= VELOCITY_WINDOW_MS,
    );
    const topLayer = motion.layers.get(top.key);
    if (!topLayer) return;
    const x = Math.min(motion.width(), Math.max(0, current.offset + dx));
    motion.paint(topLayer, motion.layers.get(below.key), x);
  }

  function release(event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = drag.current;
    drag.current = null;
    if (current?.pointerId !== event.pointerId || !current.engaged || !top || !below) return;
    const topLayer = motion.layers.get(top.key);
    const under = motion.layers.get(below.key);
    if (!topLayer) return;
    const first = current.samples[0];
    const elapsed = first ? event.timeStamp - first.time : 0;
    const measured = first && elapsed > 0 ? (event.clientX - first.x) / elapsed : 0;
    const velocity = Math.max(-MAX_VELOCITY_PX_PER_MS, Math.min(MAX_VELOCITY_PX_PER_MS, measured));
    const projected = motion.position() + velocity * PROJECTION_MS;
    const complete = !cancelled && projected > motion.width() / 2;
    motion.animateTo(topLayer, under, complete ? motion.width() : 0, velocity, () => {
      if (!complete) {
        motion.settle(topLayer, under);
        return;
      }
      motion.settle(under);
      navigator.back({ animated: false });
    });
  }

  const rendered = leaving ? [...entries, leaving] : entries;
  return (
    <div
      ref={(element) => {
        motion.setContainer(element);
      }}
      className={styles.stack}
      data-active={active || undefined}
      inert={!active}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        release(event, false);
      }}
      onPointerCancel={(event) => {
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
            isTop={isTop && !leaving}
            visible={isTop && !leaving && active}
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
