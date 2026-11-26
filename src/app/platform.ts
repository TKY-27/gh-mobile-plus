export const EDGE_BACK_WIDTH_PX = 20;

const iosNavigator = "standalone" in window.navigator ? window.navigator : null;

export const isIOS = iosNavigator !== null;

export const isIOSBrowserTab = iosNavigator?.standalone === false;

// System back owns the leading edge.
export const isAndroid = /\bAndroid\b/.test(window.navigator.userAgent);

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches || iosNavigator?.standalone === true
  );
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
