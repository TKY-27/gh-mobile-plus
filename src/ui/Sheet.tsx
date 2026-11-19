import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog } from "react-aria-components/Dialog";
import { Heading } from "react-aria-components/Heading";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import { useT } from "@/i18n/index.tsx";
import { IconButton } from "./Button.tsx";
import { moduleClass } from "./module-class.ts";
import styles from "./Sheet.module.css";

const DISMISS_DISTANCE_PX = 64;

export function Sheet(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const t = useT();
  const drag = useRef<{ id: number; y: number } | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const clearDrag = () => {
    drag.current = null;
    sheet.current?.style.removeProperty("transform");
  };
  return (
    <ModalOverlay
      isOpen={props.isOpen}
      isDismissable
      onOpenChange={props.onOpenChange}
      className={moduleClass(styles.overlay)}
    >
      <Modal ref={sheet} className={moduleClass(styles.sheet)}>
        <Dialog className={moduleClass(styles.content)}>
          {({ close }) => (
            <>
              <header
                className={styles.header}
                onPointerDown={(event) => {
                  if (!event.isPrimary || event.button !== 0) return;
                  if (event.target instanceof Element && event.target.closest("button")) return;
                  drag.current = { id: event.pointerId, y: event.clientY };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (drag.current?.id !== event.pointerId) return;
                  const offset = Math.max(0, event.clientY - drag.current.y);
                  sheet.current?.style.setProperty("transform", `translateY(${String(offset)}px)`);
                }}
                onPointerUp={(event) => {
                  if (drag.current?.id !== event.pointerId) return;
                  const distance = event.clientY - drag.current.y;
                  clearDrag();
                  if (distance >= DISMISS_DISTANCE_PX) close();
                }}
                onLostPointerCapture={clearDrag}
              >
                <Heading slot="title" className={moduleClass(styles.title)}>
                  {props.title}
                </Heading>
                <IconButton label={t("common.close")} onPress={close}>
                  <X aria-hidden />
                </IconButton>
              </header>
              <div className={styles.body}>{props.children}</div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
