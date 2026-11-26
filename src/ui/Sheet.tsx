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
const FLICK_DISTANCE_PX = 12;
const FLICK_VELOCITY_PX_PER_MS = 0.5;
// A held finger reports no moves.
const VELOCITY_WINDOW_MS = 100;

interface SheetDrag {
  id: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocity: number;
}

export function Sheet(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const t = useT();
  const drag = useRef<SheetDrag | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const endDrag = (dismiss: boolean) => {
    drag.current = null;
    const element = sheet.current;
    if (!element) return;
    delete element.dataset.dragging;
    // Exit animation continues from here.
    if (!dismiss) element.style.removeProperty("transform");
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
                  drag.current = {
                    id: event.pointerId,
                    startY: event.clientY,
                    lastY: event.clientY,
                    lastTime: event.timeStamp,
                    velocity: 0,
                  };
                  if (sheet.current) sheet.current.dataset.dragging = "";
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const current = drag.current;
                  if (current?.id !== event.pointerId) return;
                  const elapsed = event.timeStamp - current.lastTime;
                  if (elapsed > 0) current.velocity = (event.clientY - current.lastY) / elapsed;
                  current.lastY = event.clientY;
                  current.lastTime = event.timeStamp;
                  const offset = Math.max(0, event.clientY - current.startY);
                  sheet.current?.style.setProperty("transform", `translateY(${String(offset)}px)`);
                }}
                onPointerUp={(event) => {
                  const current = drag.current;
                  if (current?.id !== event.pointerId) return;
                  const distance = event.clientY - current.startY;
                  const fresh = event.timeStamp - current.lastTime <= VELOCITY_WINDOW_MS;
                  const flick = fresh && current.velocity >= FLICK_VELOCITY_PX_PER_MS;
                  const dismiss =
                    distance >= DISMISS_DISTANCE_PX || (distance >= FLICK_DISTANCE_PX && flick);
                  endDrag(dismiss);
                  if (dismiss) close();
                }}
                onLostPointerCapture={() => {
                  if (drag.current) endDrag(false);
                }}
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
