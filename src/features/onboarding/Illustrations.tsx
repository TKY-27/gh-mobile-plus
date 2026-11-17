import styles from "./Onboarding.module.css";

export function ShareIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 240 120" aria-hidden>
      <rect x="20" y="8" width="200" height="104" rx="18" className={styles.device} />
      <rect x="36" y="22" width="168" height="44" rx="8" className={styles.screen} />
      <rect x="36" y="76" width="168" height="24" rx="12" className={styles.toolbar} />
      <path d="M58 88h10M98 88h10M178 88h10" className={styles.glyph} />
      <circle cx="143" cy="88" r="15" className={styles.highlight} />
      <path
        d="M138 86v7h10v-7M143 80v10M139.5 83.5 143 80l3.5 3.5"
        className={styles.accentGlyph}
      />
    </svg>
  );
}

export function AddToHomeIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 240 120" aria-hidden>
      <rect x="20" y="8" width="200" height="104" rx="18" className={styles.device} />
      <rect x="36" y="24" width="168" height="22" rx="6" className={styles.toolbar} />
      <rect x="32" y="52" width="176" height="28" rx="8" className={styles.highlightRow} />
      <rect x="44" y="58" width="16" height="16" rx="4" className={styles.accentStroke} />
      <path d="M52 62v8M48 66h8" className={styles.accentGlyph} />
      <rect x="70" y="63" width="80" height="6" rx="3" className={styles.accentFill} />
      <rect x="36" y="86" width="168" height="22" rx="6" className={styles.toolbar} />
    </svg>
  );
}

export function HomeScreenIllustration() {
  return (
    <svg className={styles.illustration} viewBox="0 0 240 120" aria-hidden>
      <rect x="20" y="8" width="200" height="104" rx="18" className={styles.device} />
      {[44, 84, 124].map((x) => (
        <rect key={x} x={x} y="30" width="28" height="28" rx="7" className={styles.toolbar} />
      ))}
      <rect x="164" y="30" width="28" height="28" rx="7" className={styles.accentFill} />
      <rect x="164" y="64" width="28" height="5" rx="2.5" className={styles.toolbar} />
      {[44, 84].map((x) => (
        <rect key={x} x={x} y="76" width="28" height="28" rx="7" className={styles.toolbar} />
      ))}
    </svg>
  );
}
