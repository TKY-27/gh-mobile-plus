import type { InputHTMLAttributes } from "react";
import { FieldError } from "react-aria-components/FieldError";
import { Input } from "react-aria-components/Input";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";
import { TextArea as AriaTextArea } from "react-aria-components/TextArea";
import {
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components/TextField";
import { moduleClass } from "./module-class.ts";
import styles from "./fields.module.css";

type NativeInputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  "autoCapitalize" | "autoCorrect" | "spellCheck" | "inputMode"
>;

export interface TextFieldProps
  extends
    Omit<AriaTextFieldProps, "className" | "style" | "children" | keyof NativeInputProps>,
    NativeInputProps {
  label: string;
  description?: string;
  placeholder?: string;
  multiline?: boolean;
}

export function TextField({
  label,
  description,
  placeholder,
  multiline,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  inputMode,
  ...props
}: TextFieldProps) {
  const native = { autoCapitalize, autoCorrect, spellCheck, inputMode };
  return (
    <AriaTextField {...props} className={moduleClass(styles.field)}>
      <Label className={styles.label}>{label}</Label>
      {multiline ? (
        <AriaTextArea
          className={moduleClass(styles.input)}
          placeholder={placeholder ?? ""}
          {...native}
          data-multiline
        />
      ) : (
        <Input className={moduleClass(styles.input)} placeholder={placeholder ?? ""} {...native} />
      )}
      {description ? (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      ) : null}
      <FieldError className={moduleClass(styles.error)} />
    </AriaTextField>
  );
}

export function TextArea(props: Omit<TextFieldProps, "multiline">) {
  return <TextField {...props} multiline />;
}
