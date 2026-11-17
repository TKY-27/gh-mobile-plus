import type { Label } from "@/data/types";
import { labelColors } from "./label-color.ts";
import styles from "./Conversation.module.css";

export function LabelChip(props: { label: Label }) {
  const colors = labelColors(props.label.color);
  return (
    <span
      className={styles.labelChip}
      style={{ background: colors.background, color: colors.text }}
      title={props.label.description ?? undefined}
    >
      {props.label.name}
    </span>
  );
}
