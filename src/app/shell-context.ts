import { createContext, use } from "react";

export interface ShellActions {
  unreadCount: number | null;
  openMenu: () => void;
  openCommandPalette: () => void;
  openAccountSwitcher: () => void;
}

export const ShellContext = createContext<ShellActions | null>(null);

export function useShell(): ShellActions {
  const actions = use(ShellContext);
  if (!actions) throw new Error("useShell must be used inside the signed-in shell");
  return actions;
}
