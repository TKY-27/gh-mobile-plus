import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { CheckboxButton, CheckboxField } from "react-aria-components/Checkbox";
import { moduleClass } from "./module-class.ts";
import styles from "./Checkbox.module.css";

export function Checkbox(props: {
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  isDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <CheckboxField
      isSelected={props.isSelected}
      onChange={props.onChange}
      isDisabled={props.isDisabled ?? false}
    >
      <CheckboxButton className={moduleClass(styles.checkbox)}>
        <span className={styles.box} aria-hidden>
          <Check />
        </span>
        {props.children}
      </CheckboxButton>
    </CheckboxField>
  );
}
