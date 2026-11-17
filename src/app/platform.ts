const iosNavigator = "standalone" in window.navigator ? window.navigator : null;

export const isIOS = iosNavigator !== null;

export const isIOSBrowserTab = iosNavigator?.standalone === false;

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches || iosNavigator?.standalone === true
  );
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
