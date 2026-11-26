import { prefersReducedMotion } from "../platform.ts";
import { runSpring, type SpringRun } from "./spring.ts";

const PARALLAX = 0.3;
const SCRIM_OPACITY = 0.14;

export type StackMotion = ReturnType<typeof createStackMotion>;

// WebKit loses offsets while layers are hidden.
export const savedScrollTops = new WeakMap<HTMLElement, number>();

export function restoreScroll(element: HTMLElement) {
  const saved = savedScrollTops.get(element) ?? 0;
  if (element.scrollTop !== saved) element.scrollTop = saved;
}

/** Avoids React renders to keep 60 fps. */
export function createStackMotion() {
  const layers = new Map<string, HTMLDivElement>();
  let container: HTMLDivElement | null = null;
  let scrim: HTMLDivElement | null = null;
  let position = 0;
  let animation: SpringRun | null = null;

  const width = () => container?.clientWidth ?? window.innerWidth;

  function paint(moving: HTMLElement, under: HTMLElement | undefined, raw: number, span: number) {
    // Springs overshoot; never expose the edge.
    const x = Math.min(span, Math.max(0, raw));
    const fraction = x / span;
    position = x;
    moving.style.transform = `translate3d(${String(x)}px, 0, 0)`;
    if (under) {
      under.style.transform = `translate3d(${String((x - span) * PARALLAX)}px, 0, 0)`;
    }
    if (scrim) scrim.style.opacity = String((1 - fraction) * SCRIM_OPACITY);
  }

  function reveal(element: HTMLElement | undefined) {
    if (!element) return;
    element.style.visibility = "visible";
    element.style.contentVisibility = "visible";
    restoreScroll(element);
  }

  function settle(...elements: (HTMLElement | undefined)[]) {
    for (const element of elements) {
      element?.style.removeProperty("transform");
      element?.style.removeProperty("visibility");
      element?.style.removeProperty("content-visibility");
      element?.style.removeProperty("pointer-events");
    }
    if (scrim) scrim.style.opacity = "0";
    position = 0;
  }

  function stop() {
    animation?.cancel();
    animation = null;
  }

  function animateTo(
    moving: HTMLElement,
    under: HTMLElement | undefined,
    target: number,
    velocity: number,
    onDone: () => void,
  ) {
    stop();
    const span = width();
    if (prefersReducedMotion()) {
      paint(moving, under, target, span);
      onDone();
      return;
    }
    animation = runSpring(
      position,
      target,
      velocity,
      (x) => {
        paint(moving, under, x, span);
      },
      () => {
        animation = null;
        onDone();
      },
    );
  }

  return {
    layers,
    width,
    paint,
    reveal,
    settle,
    stop,
    animateTo,
    position: () => position,
    setContainer: (element: HTMLDivElement | null) => {
      container = element;
    },
    setScrim: (element: HTMLDivElement | null) => {
      scrim = element;
    },
  };
}
