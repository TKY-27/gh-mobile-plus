const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const MAX_CHANNEL = 255;
const GRAY_SPREAD = 0.15;
const DARK_LIGHTNESS = 0.3;
const LIGHT_LIGHTNESS = 0.8;
const HUE_SECTOR = 60;
const FULL_TURN = 360;
const HUE_TO_ANSI = [1, 3, 2, 6, 4, 5] as const;
const ANSI_BRIGHT_BLACK = 8;
const ANSI_BLACK = 0;
const ANSI_WHITE = 7;

function ansiVariable(index: number): string {
  return `var(--ghm-ansi-${String(index)})`;
}

function hue(red: number, green: number, blue: number, max: number, spread: number): number {
  const raw =
    max === red
      ? ((green - blue) / spread) % 6
      : max === green
        ? (blue - red) / spread + 2
        : (red - green) / spread + 4;
  return (raw * HUE_SECTOR + FULL_TURN) % FULL_TURN;
}

// Themed tokens preserve legibility.
export function themedColor(color: string): string {
  const match = HEX_COLOR.exec(color);
  if (!match) return color;
  const [red, green, blue] = match.slice(1).map((part) => Number.parseInt(part, 16) / MAX_CHANNEL);
  if (red === undefined || green === undefined || blue === undefined) return color;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const spread = max - min;
  if (spread < GRAY_SPREAD) {
    const lightness = (max + min) / 2;
    if (lightness < DARK_LIGHTNESS) return ansiVariable(ANSI_BLACK);
    return ansiVariable(lightness > LIGHT_LIGHTNESS ? ANSI_WHITE : ANSI_BRIGHT_BLACK);
  }
  const sector = Math.round(hue(red, green, blue, max, spread) / HUE_SECTOR) % HUE_TO_ANSI.length;
  return ansiVariable(HUE_TO_ANSI[sector] ?? ANSI_WHITE);
}
