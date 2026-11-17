import type { HighlightedLine } from "./tokens.ts";
import styles from "./code.module.css";

export function CodeTokens(props: { text: string; tokens: HighlightedLine | undefined }) {
  if (!props.tokens) return props.text;
  return props.tokens.map((token, index) =>
    token.kind ? (
      <span key={index} className={styles.token} data-kind={token.kind}>
        {token.text}
      </span>
    ) : (
      token.text
    ),
  );
}
