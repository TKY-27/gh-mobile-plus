import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button as AriaButton } from "react-aria-components/Button";
import { Link } from "react-aria-components/Link";
import { moduleClass } from "./module-class.ts";
import styles from "./ListRow.module.css";

export function ListSection(props: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section}>
      {props.title ? <h2 className={styles.sectionTitle}>{props.title}</h2> : null}
      <ul className={styles.group}>{props.children}</ul>
      {props.footer ? <p className={styles.sectionFooter}>{props.footer}</p> : null}
    </section>
  );
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onPress?: () => void;
}

export function ListRow(props: ListRowProps) {
  const content = (
    <>
      {props.leading ? <span className={styles.leading}>{props.leading}</span> : null}
      <span className={styles.text}>
        <span className={styles.title}>{props.title}</span>
        {props.subtitle ? <span className={styles.subtitle}>{props.subtitle}</span> : null}
      </span>
      {props.detail ? <span className={styles.detail}>{props.detail}</span> : null}
      {props.trailing}
      {props.href ? <ChevronRight className={styles.chevron} aria-hidden /> : null}
    </>
  );
  return (
    <li className={styles.item}>
      {props.href ? (
        <Link href={props.href} className={moduleClass(styles.row)}>
          {content}
        </Link>
      ) : props.onPress ? (
        <AriaButton onPress={props.onPress} className={moduleClass(styles.row)}>
          {content}
        </AriaButton>
      ) : (
        <div className={styles.row}>{content}</div>
      )}
    </li>
  );
}
