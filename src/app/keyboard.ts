import { useEffect, useState } from "react";

const KEYBOARD_MIN_HEIGHT_PX = 120;

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
      const overlap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${String(overlap)}px`);
      setOpen(
        isEditable(document.activeElement) &&
          baseline.height - viewport.height > KEYBOARD_MIN_HEIGHT_PX,
      );
    };
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
