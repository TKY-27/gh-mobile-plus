import type { ReactElement, ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { Menu as AriaMenu, MenuItem, MenuTrigger } from "react-aria-components/Menu";
import { Popover } from "react-aria-components/Popover";
import { useT } from "@/i18n/index.tsx";
import { IconButton } from "./Button.tsx";
import { moduleClass } from "./module-class.ts";
import styles from "./Menu.module.css";

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onAction: () => void;
}

export function Menu(props: {
  label: string;
  actions: readonly MenuAction[];
  trigger?: "press" | "longPress";
  children: ReactElement;
}) {
  return (
    <MenuTrigger trigger={props.trigger ?? "press"}>
      {props.children}
      <Popover className={moduleClass(styles.popover)} placement="bottom end" offset={4}>
        <AriaMenu
          aria-label={props.label}
          className={moduleClass(styles.menu)}
          items={props.actions}
          onAction={(id) => props.actions.find((action) => action.id === id)?.onAction()}
        >
          {(action) => (
            <MenuItem
              id={action.id}
              textValue={action.label}
              className={moduleClass(styles.item)}
              data-destructive={action.destructive || undefined}
            >
              <span>{action.label}</span>
              {action.icon}
            </MenuItem>
          )}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
  );
}

export function OverflowMenu(props: { actions: readonly MenuAction[] }) {
  const t = useT();
  return (
    <Menu label={t("common.moreActions")} actions={props.actions}>
      <IconButton label={t("common.moreActions")}>
        <Ellipsis aria-hidden />
      </IconButton>
    </Menu>
  );
}
