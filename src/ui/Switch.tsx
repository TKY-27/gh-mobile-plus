import type { ReactNode } from "react";
import { SwitchButton, SwitchField } from "react-aria-components/Switch";
import { moduleClass } from "./module-class.ts";
import styles from "./Switch.module.css";

export function Switch(props: {
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <SwitchField
      isSelected={props.isSelected}
      onChange={props.onChange}
      isDisabled={props.isDisabled ?? false}
    >
      <SwitchButton className={moduleClass(styles.switch)}>
        <span className={styles.label}>{props.children}</span>
        <span className={styles.track} aria-hidden>
          <span className={styles.thumb} />
        </span>
      </SwitchButton>
    </SwitchField>
  );
}
