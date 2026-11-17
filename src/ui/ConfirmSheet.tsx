import { useT } from "@/i18n/index.tsx";
import { Button } from "./Button.tsx";
import { Sheet } from "./Sheet.tsx";
import styles from "./ConfirmSheet.module.css";

export function ConfirmSheet(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Sheet isOpen={props.isOpen} onOpenChange={props.onOpenChange} title={props.title}>
      <div className={styles.confirm}>
        <p className={styles.message}>{props.message}</p>
        <Button
          variant={props.destructive ? "destructive" : "primary"}
          wide
          onPress={() => {
            props.onOpenChange(false);
            props.onConfirm();
          }}
        >
          {props.confirmLabel}
        </Button>
        <Button
          wide
          onPress={() => {
            props.onOpenChange(false);
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </Sheet>
  );
}
