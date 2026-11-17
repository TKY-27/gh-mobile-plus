const COMMIT_FRACTION = 0.35;
const MAX_COMMIT_PX = 160;
const RUBBER_COEFFICIENT = 0.55;
const PROJECTION_MS = 120;

export type SwipeAction = "done" | "read";

export function actionFor(offset: number): SwipeAction | null {
  if (offset > 0) return "done";
  if (offset < 0) return "read";
  return null;
}

export function commitDistance(width: number): number {
  return Math.min(width * COMMIT_FRACTION, MAX_COMMIT_PX);
}

function rubber(overshoot: number, dimension: number): number {
  return (1 - 1 / ((overshoot * RUBBER_COEFFICIENT) / dimension + 1)) * dimension;
}

export function rubberBand(distance: number, free: number, dimension: number): number {
  const magnitude = Math.abs(distance);
  if (magnitude <= free) return distance;
  return Math.sign(distance) * (free + rubber(magnitude - free, dimension));
}

export function shouldCommit(offset: number, velocityPerMs: number, threshold: number): boolean {
  const projected = offset + velocityPerMs * PROJECTION_MS;
  return Math.sign(projected) === Math.sign(offset) && Math.abs(projected) >= threshold;
}
