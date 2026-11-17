import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export function Badge(props: { tone?: "accent" | "neutral"; children: ReactNode }) {
  return (
    <span className={styles.badge} data-tone={props.tone ?? "neutral"}>
      {props.children}
    </span>
  );
}
