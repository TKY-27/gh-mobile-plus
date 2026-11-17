import type { ReactNode } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components/Button";
import { Spinner } from "./Spinner.tsx";
import { moduleClass } from "./module-class.ts";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "plain" | "destructive";

export interface ButtonProps extends Omit<AriaButtonProps, "className" | "style" | "children"> {
  variant?: ButtonVariant;
  wide?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  wide = false,
  icon,
  children,
  ...props
}: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={moduleClass(styles.button)}
      data-variant={variant}
      data-wide={wide || undefined}
    >
      {({ isPending }) => (
        <>
          {isPending ? <Spinner size="small" /> : icon}
          <span>{children}</span>
        </>
      )}
    </AriaButton>
  );
}

export interface IconButtonProps extends Omit<AriaButtonProps, "className" | "style" | "children"> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, ...props }: IconButtonProps) {
  return (
    <AriaButton {...props} aria-label={label} className={moduleClass(styles.iconButton)}>
      {({ isPending }) => (isPending ? <Spinner size="small" /> : children)}
    </AriaButton>
  );
}
