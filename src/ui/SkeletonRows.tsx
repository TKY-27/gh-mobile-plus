import { Skeleton } from "./Skeleton.tsx";
import styles from "./SkeletonRows.module.css";

const DEFAULT_ROWS = 3;

export function SkeletonRows(props: { rows?: number }) {
  return (
    <div className={styles.skeletonRows} aria-hidden>
      {Array.from({ length: props.rows ?? DEFAULT_ROWS }, (_, index) => (
        <div key={index} className={styles.skeletonRow}>
          <Skeleton width="2.25rem" height="2.25rem" round />
          <div className={styles.skeletonText}>
            <Skeleton width="40%" height="0.875rem" />
            <Skeleton width="85%" height="0.875rem" />
          </div>
        </div>
      ))}
    </div>
  );
}
