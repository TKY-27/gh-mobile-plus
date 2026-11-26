import { useEffect, useState } from "react";

const KEYBOARD_MIN_HEIGHT_PX = 120;
const ZOOMED_SCALE = 1.01;

function isEditable(element: Element | null): boolean {
  return (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !["checkbox", "radio", "button"].includes(element.type)) ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

export function useSoftKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let baseline = { width: window.innerWidth, height: window.innerHeight };
    const update = () => {
      if (window.innerWidth !== baseline.width) {
        baseline = { width: window.innerWidth, height: window.innerHeight };
      }
      baseline.height = Math.max(baseline.height, window.innerHeight);
      const root = document.documentElement.style;
      // Pinch zoom also shrinks the viewport.
      const zoomed = viewport.scale > ZOOMED_SCALE;
      const editing = isEditable(document.activeElement) && !zoomed;
      const overlap = editing
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      root.setProperty("--keyboard-inset", `${String(overlap)}px`);
      if (zoomed) {
        root.removeProperty("--visual-viewport-height");
        root.removeProperty("--visual-viewport-top");
      } else {
        root.setProperty("--visual-viewport-height", `${String(viewport.height)}px`);
        root.setProperty("--visual-viewport-top", `${String(viewport.offsetTop)}px`);
      }
      setOpen(editing && baseline.height - viewport.height > KEYBOARD_MIN_HEIGHT_PX);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return open;
}
