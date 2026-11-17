import { openExternal } from "@/ui/external.ts";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Ellipsis, ExternalLink } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { githubUrl } from "@/data/links";
import { useT } from "@/i18n/index.tsx";
import { IconButton } from "@/ui/Button.tsx";
import type { MenuAction } from "@/ui/Menu.tsx";
import { useNavigator } from "./navigation/context.ts";
import { useScreen } from "./navigation/screen.ts";
import { moduleClass } from "@/ui/module-class.ts";
import styles from "./Page.module.css";

const OverflowMenu = lazy(() =>
  import("@/ui/Menu.tsx").then((module) => ({ default: module.OverflowMenu })),
);

export function Page(props: {
  title: string;
  largeTitle?: boolean;
  actions?: ReactNode;
  menuActions?: readonly MenuAction[];
  openOnGitHub?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const navigator = useNavigator();
  const screen = useScreen();
  const bar = useRef<HTMLElement | null>(null);
  const largeTitle = useRef<HTMLHeadingElement | null>(null);
  const [collapsed, setCollapsed] = useState(!props.largeTitle);
  const hasLargeTitle = props.largeTitle ?? false;

  useEffect(() => {
    const title = largeTitle.current;
    const root = screen.scroller.current;
    if (!hasLargeTitle || !title || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setCollapsed(entry ? !entry.isIntersecting : false);
      },
      { root, rootMargin: `-${String(bar.current?.offsetHeight ?? 0)}px 0px 0px 0px` },
    );
    observer.observe(title);
    return () => {
      observer.disconnect();
    };
  }, [hasLargeTitle, screen.scroller]);

  const menuActions: MenuAction[] = [...(props.menuActions ?? [])];
  if (props.openOnGitHub ?? !screen.isRoot) {
    menuActions.push({
      id: "open-on-github",
      label: t("common.openOnGitHub"),
      icon: <ExternalLink aria-hidden />,
      onAction: () => {
        openExternal(githubUrl(screen.href));
      },
    });
  }

  return (
    <div className={styles.page}>
      <header ref={bar} className={styles.bar} data-collapsed={collapsed || undefined}>
        <div className={styles.barRow}>
          <div className={styles.leading}>
            {screen.isRoot ? null : (
              <AriaButton
                className={moduleClass(styles.back)}
                aria-label={t("common.back")}
                onPress={() => {
                  navigator.back({ animated: true });
                }}
              >
                <ChevronLeft aria-hidden />
              </AriaButton>
            )}
          </div>
          {hasLargeTitle ? (
            <span className={styles.compactTitle} aria-hidden>
              {props.title}
            </span>
          ) : (
            <h1 className={styles.compactTitle} tabIndex={-1}>
              {props.title}
            </h1>
          )}
          <div className={styles.trailing}>
            {props.actions}
            {menuActions.length > 0 ? (
              <Suspense
                fallback={
                  <IconButton label={t("common.moreActions")} isDisabled>
                    <Ellipsis aria-hidden />
                  </IconButton>
                }
              >
                <OverflowMenu actions={menuActions} />
              </Suspense>
            ) : null}
          </div>
        </div>
      </header>
      {hasLargeTitle ? (
        <h1 ref={largeTitle} className={styles.largeTitle} tabIndex={-1}>
          {props.title}
        </h1>
      ) : null}
      <div className={styles.content}>{props.children}</div>
    </div>
  );
}
