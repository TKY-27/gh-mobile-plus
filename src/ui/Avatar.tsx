import { useState } from "react";
import styles from "./Avatar.module.css";

const DEFAULT_SIZE_PX = 32;

// GitHub logins are ASCII; slicing is safe.
function initialsOf(name: string): string {
  return name.replace(/^@/, "").slice(0, 2).toUpperCase();
}

export function Avatar(props: { src: string | null; name: string; size?: number; label?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const size = props.size ?? DEFAULT_SIZE_PX;
  const showImage = props.src !== null && props.src !== failedSrc;
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
    >
      {showImage ? (
        <img
          src={props.src ?? undefined}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailedSrc(props.src);
          }}
        />
      ) : (
        initialsOf(props.name)
      )}
    </span>
  );
}
