import { createContext, use, useSyncExternalStore } from "react";
import type { NavigationState, Navigator } from "./navigator.ts";

export const NavigatorContext = createContext<Navigator | null>(null);

export function useNavigator(): Navigator {
  const navigator = use(NavigatorContext);
  if (!navigator) throw new Error("NavigatorContext is missing");
  return navigator;
}

export function useNavigationState(): NavigationState {
  const navigator = useNavigator();
  return useSyncExternalStore(navigator.subscribe, navigator.getState);
}
