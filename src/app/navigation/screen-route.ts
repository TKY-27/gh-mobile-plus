import type { RegisteredRouter } from "@tanstack/react-router";
import type { ScreenMatch } from "./screen.ts";

export const ROOT_ROUTE_ID = "__root__";

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

// Partial matches hide unknown paths.
export function matchScreen(router: RegisteredRouter, href: string) {
  const url = new URL(href, window.location.origin);
  const deepest = router.matchRoutes(url.pathname, router.options.parseSearch(url.search)).at(-1);
  const exact =
    deepest &&
    deepest.routeId !== ROOT_ROUTE_ID &&
    withoutTrailingSlash(deepest.pathname) === withoutTrailingSlash(url.pathname)
      ? deepest
      : undefined;
  const match: ScreenMatch = {
    routeId: exact?.routeId ?? ROOT_ROUTE_ID,
    params: exact?.params ?? {},
    search: exact?.search ?? {},
  };
  const component = exact ? router.routesById[exact.routeId].options.component : undefined;
  return { match, component };
}
