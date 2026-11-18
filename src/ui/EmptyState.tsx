import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

export function EmptyState(props: {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.icon} aria-hidden>
        {props.icon}
      </span>
      <h2 className={styles.title}>{props.title}</h2>
      <p className={styles.message}>{props.message}</p>
      {props.action ? <div className={styles.action}>{props.action}</div> : null}
    </div>
  );
}
