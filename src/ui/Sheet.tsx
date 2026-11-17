import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Heading } from "react-aria-components/Heading";
import {
  Sheet as AriaSheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
} from "react-aria-components/Sheet";
import { useT } from "@/i18n/index.tsx";
import { IconButton } from "./Button.tsx";
import { moduleClass } from "./module-class.ts";
import styles from "./Sheet.module.css";

export function Sheet(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <SheetOverlay
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      className={moduleClass(styles.overlay)}
    >
      <SheetBackdrop
        className={moduleClass(styles.backdrop)}
        swipeAnimation={moduleClass(styles.fadeIn)}
      />
      <AriaSheet className={moduleClass(styles.sheet)}>
        <SheetContent className={moduleClass(styles.content)}>
          {({ close }) => (
            <>
              <span className={styles.grabber} aria-hidden />
              <header className={styles.header}>
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
        </SheetContent>
      </AriaSheet>
    </SheetOverlay>
  );
}
