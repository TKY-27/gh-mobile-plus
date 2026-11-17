import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { runSpring, type SpringRun } from "@/app/navigation/spring.ts";
import { commitDistance, rubberBand, shouldCommit } from "@/features/inbox/swipe.ts";

// Reserve the edge for back navigation.
const EDGE_EXCLUSION_PX = 24;
const SLOP_PX = 12;
const VELOCITY_WINDOW_MS = 100;
const DOMINANCE = 1.2;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export type SwipeDirection = 1 | -1;

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  engaged: boolean;
  offset: number;
  samples: { x: number; time: number }[];
}

function reducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches;
}

/** Imperative transforms keep drags off React renders. */
function createSurfaceMotion() {
  let element: HTMLElement | null = null;
  let spring: SpringRun | null = null;
  const paint = (x: number) => {
    if (element) element.style.transform = x === 0 ? "" : `translateX(${String(x)}px)`;
  };
  return {
    attach: (next: HTMLElement | null) => {
      element = next;
    },
    width: () => element?.clientWidth ?? 0,
    paint: (x: number) => {
      spring?.cancel();
      paint(x);
    },
    settle: (from: number, to: number, velocity: number, done: () => void) => {
      spring?.cancel();
      if (reducedMotion()) {
        paint(0);
        done();
        return;
      }
      spring = runSpring(from, to, velocity, paint, done);
    },
    cancel: () => {
      spring?.cancel();
    },
  };
}

export function useFileSwipe(options: {
  fileKey: string;
  enabled: boolean;
  canGo: (direction: SwipeDirection) => boolean;
  onSwipe: (direction: SwipeDirection) => void;
}) {
  const [motion] = useState(createSurfaceMotion);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const entering = useRef<SwipeDirection | null>(null);
  const { fileKey, enabled, canGo, onSwipe } = options;

  useEffect(() => motion.cancel, [motion]);

  useLayoutEffect(() => {
    const direction = entering.current;
    entering.current = null;
    const width = motion.width();
    if (direction !== null && width > 0) motion.settle(direction * width, 0, 0, () => undefined);
  }, [fileKey, motion]);

  const navigate = (direction: SwipeDirection) => {
    entering.current = reducedMotion() ? null : direction;
    onSwipe(direction);
  };

  const release = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.pointerId !== event.pointerId || !current.engaged) return;
    suppressClick.current = true;
    const width = motion.width();
    const first = current.samples[0];
    const elapsed = first ? event.timeStamp - first.time : 0;
    const velocity = first && elapsed > 0 ? (event.clientX - first.x) / elapsed : 0;
    const direction: SwipeDirection = current.offset < 0 ? 1 : -1;
    const commit =
      !cancelled &&
      canGo(direction) &&
      shouldCommit(current.offset, velocity, commitDistance(width));
    if (!commit) {
      motion.settle(current.offset, 0, velocity, () => undefined);
      return;
    }
    motion.settle(current.offset, -direction * width, velocity, () => {
      navigate(direction);
    });
  };

  return {
    ref: motion.attach,
    go: (direction: SwipeDirection) => {
      if (canGo(direction)) navigate(direction);
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!enabled || !event.isPrimary || event.pointerType === "mouse") return;
      const fromEdge = event.clientX - event.currentTarget.getBoundingClientRect().left;
      if (fromEdge < EDGE_EXCLUSION_PX) return;
      if (event.target instanceof Element && event.target.closest("[data-handle]")) return;
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        engaged: false,
        offset: 0,
        samples: [{ x: event.clientX, time: event.timeStamp }],
      };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (current?.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (!current.engaged) {
        if (Math.abs(dy) > SLOP_PX && Math.abs(dy) > Math.abs(dx)) {
          gesture.current = null;
          return;
        }
        if (Math.abs(dx) < SLOP_PX || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
        current.engaged = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      current.samples = [...current.samples, { x: event.clientX, time: event.timeStamp }].filter(
        (sample) => event.timeStamp - sample.time <= VELOCITY_WINDOW_MS,
      );
      const width = motion.width();
      const direction: SwipeDirection = dx < 0 ? 1 : -1;
      current.offset = rubberBand(dx, canGo(direction) ? width : 0, width);
      motion.paint(current.offset);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      release(event, false);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      release(event, true);
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.stopPropagation();
      event.preventDefault();
    },
  };
}
