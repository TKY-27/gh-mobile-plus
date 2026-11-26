import type { HistoryLocation, RouterHistory } from "@tanstack/react-router";

export type Tab = "home" | "repositories" | "work" | "search" | "account";

export const TABS: readonly Tab[] = ["home", "repositories", "work", "search", "account"];

export const TAB_ROOTS: Readonly<Record<Tab, string>> = {
  home: "/",
  work: "/pulls",
  repositories: "/repositories",
  search: "/search",
  account: "/account",
};

const ACCOUNT_SCREENS = /^\/settings(?:\/|$)/;

export interface StackEntry {
  key: string;
  href: string;
  pathname: string;
}

export interface LeavingEntry {
  tab: Tab;
  entry: StackEntry;
}

export interface NavigationState {
  activeTab: Tab;
  // Avoid requests from unvisited tabs.
  visited: readonly Tab[];
  stacks: Readonly<Record<Tab, readonly StackEntry[]>>;
  leaving: LeavingEntry | null;
}

export function rootTabOf(pathname: string): Tab | null {
  return TABS.find((tab) => TAB_ROOTS[tab] === pathname) ?? null;
}

export function homeTabFor(pathname: string): Tab {
  return rootTabOf(pathname) ?? (ACCOUNT_SCREENS.test(pathname) ? "account" : "home");
}

function entryOf(location: HistoryLocation): StackEntry {
  return {
    key: location.state.__TSR_key ?? location.state.key ?? location.href,
    href: location.href,
    pathname: location.pathname,
  };
}

function rootEntry(tab: Tab): StackEntry {
  return { key: `root:${tab}`, href: TAB_ROOTS[tab], pathname: TAB_ROOTS[tab] };
}

function withStack(
  state: NavigationState,
  tab: Tab,
  stack: readonly StackEntry[],
  leaving: LeavingEntry | null = null,
): NavigationState {
  return { ...state, activeTab: tab, stacks: { ...state.stacks, [tab]: stack }, leaving };
}

export function initialState(location: HistoryLocation): NavigationState {
  const tab = homeTabFor(location.pathname);
  const stacks: Record<Tab, readonly StackEntry[]> = {
    home: [rootEntry("home")],
    work: [rootEntry("work")],
    repositories: [rootEntry("repositories")],
    search: [rootEntry("search")],
    account: [rootEntry("account")],
  };
  const root = rootTabOf(location.pathname);
  stacks[tab] = root ? [entryOf(location)] : [rootEntry(tab), entryOf(location)];
  return { activeTab: tab, visited: [tab], stacks, leaving: null };
}

export function topOf(state: NavigationState, tab: Tab = state.activeTab): StackEntry {
  const top = state.stacks[tab].at(-1);
  if (!top) throw new Error(`Empty stack for ${tab}`);
  return top;
}

export function pushed(state: NavigationState, location: HistoryLocation): NavigationState {
  const root = rootTabOf(location.pathname);
  if (root) return withStack(state, root, [entryOf(location)]);
  return withStack(state, state.activeTab, [...state.stacks[state.activeTab], entryOf(location)]);
}

export function replaced(state: NavigationState, location: HistoryLocation): NavigationState {
  const root = rootTabOf(location.pathname);
  const stack = state.stacks[state.activeTab];
  if (root && (root !== state.activeTab || stack.length > 1)) {
    return withStack(state, root, [entryOf(location)]);
  }
  const top = topOf(state);
  return withStack(state, state.activeTab, [
    ...stack.slice(0, -1),
    { ...entryOf(location), key: top.key },
  ]);
}

export function popped(state: NavigationState, count: number, animated: boolean): NavigationState {
  const stack = state.stacks[state.activeTab];
  const remaining = stack.slice(0, Math.max(1, stack.length - count));
  if (remaining.length === stack.length) return state;
  const leaving = animated ? { tab: state.activeTab, entry: topOf(state) } : null;
  return withStack(state, state.activeTab, remaining, leaving);
}

export function switched(state: NavigationState, tab: Tab): NavigationState {
  return { ...state, activeTab: tab, leaving: null };
}

export interface NavigatorOptions {
  animatePopsFromHistory: boolean;
}

export type Navigator = ReturnType<typeof createNavigator>;

export function createNavigator(history: RouterHistory, options: NavigatorOptions) {
  let state = initialState(history.location);
  let historyIndex = history.location.state.__TSR_index;
  let internalHref: string | null = null;
  let nextPopAnimated = options.animatePopsFromHistory;
  // Browsers apply history.go asynchronously.
  let traversing = false;
  const listeners = new Set<() => void>();

  function commit(next: NavigationState) {
    if (next === state) return;
    state = next.visited.includes(next.activeTab)
      ? next
      : { ...next, visited: [...next.visited, next.activeTab] };
    for (const listener of listeners) listener();
  }

  function replaceUrl(href: string) {
    if (history.location.href === href) return;
    internalHref = href;
    history.replace(href);
  }

  function popBy(count: number, location: HistoryLocation) {
    const animated = nextPopAnimated;
    nextPopAnimated = options.animatePopsFromHistory;
    if (state.stacks[state.activeTab].length > 1) {
      commit(popped(state, count, animated));
    } else if (state.activeTab !== "home") {
      commit(switched(state, "home"));
    } else {
      commit(rootTabOf(location.pathname) ? state : pushed(state, location));
      return;
    }
    replaceUrl(topOf(state).href);
  }

  function onHistory(location: HistoryLocation, action: string) {
    traversing = false;
    const index = location.state.__TSR_index;
    const delta = index - historyIndex;
    historyIndex = index;
    if (action === "REPLACE" && internalHref === location.href) {
      internalHref = null;
      return;
    }
    if (action === "PUSH" || (action !== "REPLACE" && delta > 0)) commit(pushed(state, location));
    else if (action === "REPLACE") commit(replaced(state, location));
    else if (delta < 0) popBy(-delta, location);
  }

  // Give cold deep links a back target.
  if (state.stacks[state.activeTab].length > 1 && historyIndex === 0) {
    const deepLink = history.location.href;
    internalHref = TAB_ROOTS[state.activeTab];
    history.replace(TAB_ROOTS[state.activeTab]);
    history.push(deepLink);
    historyIndex = history.location.state.__TSR_index;
    state = initialState(history.location);
  }

  history.subscribe(({ location, action }) => {
    onHistory(location, action.type);
  });

  function back(count: number, animated: boolean) {
    const depth = state.stacks[state.activeTab].length;
    const steps = Math.min(count, depth - 1);
    if (steps < 1 || traversing) return;
    if (historyIndex >= steps) {
      nextPopAnimated = animated;
      traversing = true;
      history.go(-steps);
      return;
    }
    commit(popped(state, steps, animated));
    replaceUrl(topOf(state).href);
  }

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    back: (options: { animated: boolean }) => {
      back(1, options.animated);
    },
    popToRoot: () => {
      back(Number.POSITIVE_INFINITY, true);
    },
    selectTab: (tab: Tab) => {
      if (tab === state.activeTab) return;
      commit(switched(state, tab));
      replaceUrl(topOf(state).href);
    },
    finishLeaving: (key: string) => {
      if (state.leaving?.entry.key === key) commit({ ...state, leaving: null });
    },
  };
}
