import { useCallback } from "react";
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
const FLICK_PX_PER_MS = 0.5;
const SLOP_PX = 10;
// A held finger reports no moves.
const VELOCITY_WINDOW_MS = 100;

// Native listeners: iOS needs a non-passive touchmove.
function trackCloseSwipe(panel: HTMLElement, close: () => void): () => void {
  let start: { id: number; x: number; y: number } | null = null;
  let last = { x: 0, time: 0, velocity: 0 };
  let engaged = false;
  const reset = () => {
    start = null;
    engaged = false;
    delete panel.dataset.dragging;
    panel.style.removeProperty("transform");
  };
  const onStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    reset();
    if (!touch) return;
    start = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    last = { x: touch.clientX, time: event.timeStamp, velocity: 0 };
  };
  const onMove = (event: TouchEvent) => {
    const touch = [...event.touches].find((candidate) => candidate.identifier === start?.id);
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (!engaged) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= SLOP_PX) return;
      if (dx >= 0 || Math.abs(dy) >= Math.abs(dx)) {
        start = null;
        return;
      }
      engaged = true;
      panel.dataset.dragging = "";
    }
    if (event.cancelable) event.preventDefault();
    const elapsed = event.timeStamp - last.time;
    if (elapsed > 0) last.velocity = (touch.clientX - last.x) / elapsed;
    last = { ...last, x: touch.clientX, time: event.timeStamp };
    panel.style.transform = `translate3d(${String(Math.min(0, dx))}px, 0, 0)`;
  };
  const onEnd = (event: TouchEvent) => {
    const touch = [...event.changedTouches].find((candidate) => candidate.identifier === start?.id);
    const distance = start && touch ? start.x - touch.clientX : 0;
    const fresh = event.timeStamp - last.time <= VELOCITY_WINDOW_MS;
    const flick = fresh && -last.velocity >= FLICK_PX_PER_MS;
    const shouldClose = engaged && (distance >= CLOSE_SWIPE_PX || flick);
    if (shouldClose) {
      start = null;
      engaged = false;
      delete panel.dataset.dragging;
      close();
    } else reset();
  };
  panel.addEventListener("touchstart", onStart, { passive: true });
  panel.addEventListener("touchmove", onMove, { passive: false });
  panel.addEventListener("touchend", onEnd, { passive: true });
  panel.addEventListener("touchcancel", reset, { passive: true });
  return () => {
    panel.removeEventListener("touchstart", onStart);
    panel.removeEventListener("touchmove", onMove);
    panel.removeEventListener("touchend", onEnd);
    panel.removeEventListener("touchcancel", reset);
  };
}

export default function NavigationMenu(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const account = useActiveAccount();
  const t = useT();
  const shell = useShell();
  const { onOpenChange } = props;
  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  const attachPanel = useCallback(
    (panel: HTMLDivElement | null) => (panel ? trackCloseSwipe(panel, close) : undefined),
    [close],
  );
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
      isOpen={props.isOpen}
      isDismissable
      className={moduleClass(styles.overlay)}
      onOpenChange={props.onOpenChange}
    >
      <Modal ref={attachPanel} className={moduleClass(styles.modal)}>
        <Dialog className={moduleClass(styles.panel)} aria-label={t("app.menu.title")}>
          <div>
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
