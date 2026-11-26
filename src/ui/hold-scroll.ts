// WebKit cancels pointers once vertical scrolling starts.
export function holdScrollWhile(element: HTMLElement, engaged: () => boolean): () => void {
  const hold = (event: TouchEvent) => {
    if (engaged() && event.cancelable) event.preventDefault();
  };
  element.addEventListener("touchmove", hold, { passive: false });
  return () => {
    element.removeEventListener("touchmove", hold);
  };
}
