import { spring } from "motion";

const STACK_SPRING = { visualDuration: 0.32, bounce: 0 };
const MS_PER_SECOND = 1000;

export interface SpringRun {
  cancel(): void;
}

/** Per-frame values let gestures hand off velocity. */
export function runSpring(
  from: number,
  to: number,
  velocityPerMs: number,
  onFrame: (value: number) => void,
  onDone: () => void,
): SpringRun {
  const generator = spring({
    ...STACK_SPRING,
    keyframes: [from, to],
    velocity: velocityPerMs * MS_PER_SECOND,
  });
  let frame = 0;
  let start: number | null = null;
  const step = (time: number) => {
    start ??= time;
    const { value, done } = generator.next(time - start);
    onFrame(done ? to : value);
    if (done) onDone();
    else frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return {
    cancel: () => {
      cancelAnimationFrame(frame);
    },
  };
}
