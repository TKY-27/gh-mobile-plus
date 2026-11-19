import { useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useScreen } from "@/app/navigation/screen.ts";
import { prefersReducedMotion } from "@/app/platform.ts";
import { runSpring, type SpringRun } from "@/app/navigation/spring.ts";
import { commitDistance, rubberBand, shouldCommit } from "@/features/inbox/swipe.ts";

// Reserve the edge for back navigation.
const EDGE_EXCLUSION_PX = 24;
const SLOP_PX = 12;
const VELOCITY_WINDOW_MS = 100;
const DOMINANCE = 1.2;

export type SwipeDirection = 1 | -1;

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  engaged: boolean;
  startOffset: number;
  samples: { x: number; time: number }[];
}

/** Imperative transforms keep drags off React renders. */
function createSurfaceMotion() {
  let element: HTMLElement | null = null;
  let spring: SpringRun | null = null;
  let position = 0;
  const paint = (x: number) => {
    position = x;
    if (element) element.style.transform = x === 0 ? "" : `translateX(${String(x)}px)`;
  };
  return {
    attach: (next: HTMLElement | null) => {
      element = next;
    },
    width: () => element?.clientWidth ?? 0,
    position: () => position,
    paint: (x: number) => {
      spring?.cancel();
      paint(x);
    },
    settle: (from: number, velocity: number) => {
      spring?.cancel();
      if (prefersReducedMotion()) {
        paint(0);
        return;
      }
      paint(from);
      spring = runSpring(from, 0, velocity, paint, () => undefined);
    },
  };
}

export function useFileSwipe(options: {
  fileKey: string;
  enabled: boolean;
  canGo: (direction: SwipeDirection) => boolean;
  onSwipe: (direction: SwipeDirection) => void;
}) {
  const { scroller, isTop } = useScreen();
  const [motion] = useState(createSurfaceMotion);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const entering = useRef<{ offset: number; velocity: number } | null>(null);
  const { fileKey, enabled, canGo, onSwipe } = options;

  useLayoutEffect(() => {
    gesture.current = null;
    const transition = entering.current;
    entering.current = null;
    if (isTop && transition) motion.settle(transition.offset, transition.velocity);
    return () => {
      motion.paint(0);
    };
  }, [fileKey, enabled, isTop, motion]);

  const navigate = (direction: SwipeDirection, offset = 0, velocity = 0) => {
    entering.current = { offset: direction * motion.width() + offset, velocity };
    onSwipe(direction);
  };

  const release = (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const current = gesture.current;
    if (current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (!current.engaged) return;
    suppressClick.current = true;
    const width = motion.width();
    const first = current.samples[0];
    const elapsed = first ? event.timeStamp - first.time : 0;
    const velocity = first && elapsed > 0 ? (event.clientX - first.x) / elapsed : 0;
    const travel = event.clientX - current.startX;
    const direction: SwipeDirection = travel < 0 ? 1 : -1;
    const commit =
      !cancelled && canGo(direction) && shouldCommit(travel, velocity, commitDistance(width));
    if (!commit) {
      motion.settle(motion.position(), velocity);
      return;
    }
    navigate(direction, motion.position(), velocity);
  };

  return {
    ref: motion.attach,
    go: (direction: SwipeDirection) => {
      if (canGo(direction)) navigate(direction);
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!event.isPrimary) return;
      suppressClick.current = false;
      if (!enabled || !isTop || event.pointerType === "mouse") return;
      const fromEdge = event.clientX - (scroller.current?.getBoundingClientRect().left ?? 0);
      if (fromEdge < EDGE_EXCLUSION_PX) return;
      if (event.target instanceof Element && event.target.closest("[data-handle]")) return;
      gesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        engaged: false,
        startOffset: 0,
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
        current.startOffset = motion.position();
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      current.samples = [...current.samples, { x: event.clientX, time: event.timeStamp }].filter(
        (sample) => event.timeStamp - sample.time <= VELOCITY_WINDOW_MS,
      );
      const width = motion.width();
      const direction: SwipeDirection = dx < 0 ? 1 : -1;
      motion.paint(current.startOffset + rubberBand(dx, canGo(direction) ? width : 0, width));
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
