import { createContext, use, type RefObject } from "react";
import type { AnyRoute } from "@tanstack/react-router";

export interface ScreenMatch {
  routeId: string;
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
}

export interface ScreenValue {
  href: string;
  isRoot: boolean;
  isTop: boolean;
  match: ScreenMatch;
  scroller: RefObject<HTMLDivElement | null>;
}

export const ScreenContext = createContext<ScreenValue | null>(null);

export function useScreen(): ScreenValue {
  const value = use(ScreenContext);
  if (!value) throw new Error("useScreen must be used inside a stack screen");
  return value;
}

function assertRoute(match: ScreenMatch, route: AnyRoute): void {
  const expected: unknown = route.id;
  if (match.routeId !== expected) {
    throw new Error("Screen asked for another route's params: " + match.routeId);
  }
}

// Router hooks only see the top screen.
export function useScreenParams<TRoute extends AnyRoute>(
  route: TRoute,
): TRoute["types"]["allParams"] {
  const { match } = useScreen();
  assertRoute(match, route);
  return match.params;
}

export function useScreenSearch<TRoute extends AnyRoute>(
  route: TRoute,
): TRoute["types"]["fullSearchSchema"] {
  const { match } = useScreen();
  assertRoute(match, route);
  return match.search;
}
