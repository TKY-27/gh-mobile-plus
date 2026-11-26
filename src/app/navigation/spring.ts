const VISUAL_DURATION_S = 0.32;
const OMEGA = (2 * Math.PI) / VISUAL_DURATION_S;
const REST_DELTA_PX = 0.5;
// px/s; lower values outlast the visible motion.
const REST_VELOCITY = 20;
const MAX_DURATION_S = 2;
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
  const x0 = from - to;
  const v0 = velocityPerMs * MS_PER_SECOND;
  let frame = 0;
  let start: number | null = null;
  const step = (time: number) => {
    start ??= time;
    const elapsed = (time - start) / MS_PER_SECOND;
    const decay = Math.exp(-OMEGA * elapsed);
    const linear = v0 + OMEGA * x0;
    const offset = (x0 + linear * elapsed) * decay;
    const velocity = (v0 - OMEGA * linear * elapsed) * decay;
    const done =
      elapsed >= MAX_DURATION_S ||
      (Math.abs(offset) < REST_DELTA_PX && Math.abs(velocity) < REST_VELOCITY);
    onFrame(done ? to : to + offset);
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
