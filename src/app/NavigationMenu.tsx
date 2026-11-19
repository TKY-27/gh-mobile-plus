import { useRef, type Touch } from "react";
import { Dialog } from "react-aria-components/Dialog";
import { Modal, ModalOverlay } from "react-aria-components/Modal";
import {
  Bell,
  BookMarked,
  ChevronsUpDown,
  Search,
  Settings,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { Link } from "react-aria-components/Link";
import { useActiveAccount } from "@/data/session";
import { useT } from "@/i18n/index.tsx";
import { Avatar } from "@/ui/Avatar.tsx";
import { IconButton } from "@/ui/Button.tsx";
import { moduleClass } from "@/ui/module-class.ts";
import { useShell } from "./shell-context.ts";
import styles from "./NavigationMenu.module.css";

const CLOSE_SWIPE_PX = 64;

export default function NavigationMenu(props: { onOpenChange: (open: boolean) => void }) {
  const account = useActiveAccount();
  const touchStart = useRef<Touch | null>(null);
  const t = useT();
  const shell = useShell();
  const close = () => {
    props.onOpenChange(false);
  };
  const links = [
    [`/${account.login}`, "app.menu.profile", UserRound],
    ["/notifications", "app.tabs.inbox", Bell],
    [`/${account.login}?tab=repositories`, "app.tabs.repositories", BookMarked],
    [`/${account.login}?tab=stars`, "account.lists.starred", Star],
    ["/settings", "app.settings.root", Settings],
  ] as const;
  function run(action: () => void) {
    close();
    action();
  }
  return (
    <ModalOverlay
      isOpen
      isDismissable
      className={moduleClass(styles.overlay)}
      onOpenChange={props.onOpenChange}
    >
      <Modal className={moduleClass(styles.modal)}>
        <Dialog className={moduleClass(styles.panel)} aria-label={t("app.menu.title")}>
          <div
            onTouchStart={(event) => {
              touchStart.current = event.touches.length === 1 ? event.touches.item(0) : null;
            }}
            onTouchCancel={() => {
              touchStart.current = null;
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              touchStart.current = null;
              const end = event.changedTouches[0];
              if (!start || !end || start.identifier !== end.identifier) return;
              const distance = start.clientX - end.clientX;
              if (
                distance >= CLOSE_SWIPE_PX &&
                distance > Math.abs(end.clientY - start.clientY) * 2
              )
                close();
            }}
          >
            <div className={styles.identity}>
              <Link
                href={`/${account.login}`}
                onPress={close}
                className={moduleClass(styles.profile)}
              >
                <Avatar src={account.avatarUrl} name={account.login} size={52} />
                <strong>@{account.login}</strong>
              </Link>
              <div className={styles.utilities}>
                <AriaButton
                  className={moduleClass(styles.switcher)}
                  aria-label={t("app.accounts.switch")}
                  onPress={() => {
                    run(shell.openAccountSwitcher);
                  }}
                >
                  <ChevronsUpDown aria-hidden />
                </AriaButton>
                <IconButton label={t("common.close")} onPress={close}>
                  <X aria-hidden />
                </IconButton>
              </div>
            </div>
            <nav className={styles.links} aria-label={t("app.menu.title")}>
              {links.map(([href, label, Icon]) => (
                <Link key={href} href={href} onPress={close} className={moduleClass(styles.row)}>
                  <Icon aria-hidden /> {t(label)}
                </Link>
              ))}
              <AriaButton
                className={moduleClass(styles.row)}
                onPress={() => {
                  run(shell.openCommandPalette);
                }}
              >
                <Search aria-hidden /> {t("app.palette.title")}
              </AriaButton>
            </nav>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
