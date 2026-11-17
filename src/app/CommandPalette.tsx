import { useState } from "react";
import { ArrowUpRight, Settings } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Autocomplete } from "react-aria-components/Autocomplete";
import { Dialog } from "react-aria-components/Dialog";
import { Menu, MenuItem } from "react-aria-components/Menu";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import { toAppPath } from "@/data/links";
import { useT } from "@/i18n/index.tsx";
import { SearchField } from "@/ui/SearchField.tsx";
import { SETTINGS_SECTIONS } from "./settings-sections.ts";
import { moduleClass } from "@/ui/module-class.ts";
import styles from "./CommandPalette.module.css";

interface Destination {
  id: string;
  label: string;
  path: string;
  kind: "jump" | "settings";
}

export default function CommandPalette(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const jump = trimmed ? toAppPath(trimmed) : null;
  const needle = trimmed.toLocaleLowerCase();
  const destinations: Destination[] = [
    ...(jump ? [{ id: `jump:${jump}`, label: trimmed, path: jump, kind: "jump" as const }] : []),
    ...SETTINGS_SECTIONS.map((section) => ({
      id: section.path,
      label: t(section.label),
      path: section.path,
      kind: "settings" as const,
    })).filter((section) => section.label.toLocaleLowerCase().includes(needle)),
  ];

  const close = () => {
    props.onOpenChange(false);
    setQuery("");
  };

  return (
    <ModalOverlay
      isOpen={props.isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      isDismissable
      className={moduleClass(styles.overlay)}
    >
      <Modal className={moduleClass(styles.modal)}>
        <Dialog aria-label={t("app.palette.title")} className={moduleClass(styles.dialog)}>
          <Autocomplete inputValue={query} onInputChange={setQuery}>
            <SearchField
              label={t("app.palette.title")}
              placeholder={t("app.palette.placeholder")}
              autoFocus
            />
            <Menu
              items={destinations}
              className={moduleClass(styles.results)}
              aria-label={t("app.palette.results")}
              renderEmptyState={() => <p className={styles.empty}>{t("app.palette.empty")}</p>}
              onAction={(id) => {
                const destination = destinations.find((each) => each.id === id);
                if (!destination) return;
                close();
                router.history.push(destination.path);
              }}
            >
              {(destination) => (
                <MenuItem
                  id={destination.id}
                  textValue={destination.label}
                  className={moduleClass(styles.item)}
                >
                  {destination.kind === "jump" ? (
                    <ArrowUpRight aria-hidden />
                  ) : (
                    <Settings aria-hidden />
                  )}
                  <span className={styles.label}>
                    {destination.kind === "jump"
                      ? t("app.palette.jump", { target: destination.label })
                      : destination.label}
                  </span>
                </MenuItem>
              )}
            </Menu>
          </Autocomplete>
          <p className={styles.hint}>{t("app.palette.hint")}</p>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
