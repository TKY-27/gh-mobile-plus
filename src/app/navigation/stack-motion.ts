import { prefersReducedMotion } from "../platform.ts";
import { runSpring, type SpringRun } from "./spring.ts";

const PARALLAX = 0.3;
const SCRIM_OPACITY = 0.14;

export type StackMotion = ReturnType<typeof createStackMotion>;

/** Avoids React renders to keep 60 fps. */
export function createStackMotion() {
  const layers = new Map<string, HTMLDivElement>();
  let container: HTMLDivElement | null = null;
  let scrim: HTMLDivElement | null = null;
  let position = 0;
  let animation: SpringRun | null = null;

  const width = () => container?.clientWidth ?? window.innerWidth;

  function paint(moving: HTMLElement, under: HTMLElement | undefined, x: number) {
    const fraction = Math.min(1, Math.max(0, x / width()));
    position = x;
    moving.style.transform = `translate3d(${String(x)}px, 0, 0)`;
    if (under) {
      under.style.transform = `translate3d(${String((x - width()) * PARALLAX)}px, 0, 0)`;
    }
    if (scrim) scrim.style.opacity = String((1 - fraction) * SCRIM_OPACITY);
  }

  function reveal(element: HTMLElement | undefined) {
    if (!element) return;
    element.style.visibility = "visible";
    element.style.contentVisibility = "visible";
  }

  function settle(...elements: (HTMLElement | undefined)[]) {
    for (const element of elements) {
      element?.style.removeProperty("transform");
      element?.style.removeProperty("visibility");
      element?.style.removeProperty("content-visibility");
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
    if (prefersReducedMotion()) {
      onDone();
      return;
    }
    animation = runSpring(
      position,
      target,
      velocity,
      (x) => {
        paint(moving, under, x);
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
    isAnimating: () => animation !== null,
    setContainer: (element: HTMLDivElement | null) => {
      container = element;
    },
    setScrim: (element: HTMLDivElement | null) => {
      scrim = element;
    },
  };
}
