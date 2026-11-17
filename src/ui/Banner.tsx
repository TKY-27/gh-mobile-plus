import type { ReactNode } from "react";
import styles from "./Banner.module.css";

export function Banner(props: {
  icon: ReactNode;
  tone?: "neutral" | "warning";
  children: ReactNode;
}) {
  return (
    <div role="status" className={styles.banner} data-tone={props.tone ?? "neutral"}>
      <span className={styles.icon} aria-hidden>
        {props.icon}
      </span>
      <span>{props.children}</span>
    </div>
  );
}
