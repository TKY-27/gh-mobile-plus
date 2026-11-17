import { ProgressBar } from "react-aria-components/ProgressBar";
import { useT } from "@/i18n/index.tsx";
import { moduleClass } from "./module-class.ts";
import styles from "./Spinner.module.css";

export function Spinner(props: { size?: "small" | "large"; label?: string }) {
  const t = useT();
  return (
    <ProgressBar
      isIndeterminate
      aria-label={props.label ?? t("common.loading")}
      className={moduleClass(styles.spinner)}
      data-size={props.size ?? "large"}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="9" />
      </svg>
    </ProgressBar>
  );
}
