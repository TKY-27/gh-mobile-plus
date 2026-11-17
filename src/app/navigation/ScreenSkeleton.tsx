import { Skeleton } from "@/ui/Skeleton.tsx";
import styles from "./ScreenSkeleton.module.css";

const ROWS = 6;

export function ScreenSkeleton() {
  return (
    <div className={styles.skeleton}>
      <Skeleton width="45%" height="2rem" />
      {Array.from({ length: ROWS }, (_, index) => (
        <Skeleton key={index} width="100%" height="3rem" />
      ))}
    </div>
  );
}
