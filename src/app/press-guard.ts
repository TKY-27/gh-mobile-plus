// pan-y never cancels presses on horizontal drags.
const DRAG_SLOP_PX = 10;

interface Origin {
  pointerId: number;
  x: number;
  y: number;
}

export function installPressGuard(target: Window): () => void {
  let origin: Origin | null = null;

  const onDown = (event: PointerEvent) => {
    origin =
      event.pointerType === "mouse"
        ? null
        : { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onMove = (event: PointerEvent) => {
    if (origin?.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (distance <= DRAG_SLOP_PX) return;
    origin = null;
    // Only React Aria's document listener sees this.
    target.document.dispatchEvent(
      new PointerEvent("pointercancel", {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
      }),
    );
  };
  const onEnd = (event: PointerEvent) => {
    if (origin?.pointerId === event.pointerId) origin = null;
  };

  const options = { capture: true, passive: true };
  target.addEventListener("pointerdown", onDown, options);
  target.addEventListener("pointermove", onMove, options);
  target.addEventListener("pointerup", onEnd, options);
  target.addEventListener("pointercancel", onEnd, options);
  return () => {
    target.removeEventListener("pointerdown", onDown, options);
    target.removeEventListener("pointermove", onMove, options);
    target.removeEventListener("pointerup", onEnd, options);
    target.removeEventListener("pointercancel", onEnd, options);
  };
}
