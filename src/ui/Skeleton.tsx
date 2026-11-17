import styles from "./Skeleton.module.css";

export function Skeleton(props: { width: string; height: string; round?: boolean }) {
  return (
    <span
      className={styles.skeleton}
      data-round={props.round || undefined}
      style={{ width: props.width, height: props.height }}
      aria-hidden
    />
  );
}
