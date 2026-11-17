const HEX_COLOR = /^#?([0-9a-f]{6})$/i;
const FALLBACK_COLOR = "ededed";
const LINEAR_THRESHOLD = 0.04045;
const BLACK_LUMINANCE = 0;
const WHITE_LUMINANCE = 1;
const CONTRAST_OFFSET = 0.05;
const CHANNEL_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const LINEAR_SCALE = 12.92;
const GAMMA = 2.4;
const GAMMA_OFFSET = 0.055;
const MAX_CHANNEL = 255;

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / MAX_CHANNEL;
  return value <= LINEAR_THRESHOLD
    ? value / LINEAR_SCALE
    : ((value + GAMMA_OFFSET) / (1 + GAMMA_OFFSET)) ** GAMMA;
}

function luminance(hex: string): number {
  const [red, green, blue] = CHANNEL_WEIGHTS;
  return red * channel(hex, 0) + green * channel(hex, 2) + blue * channel(hex, 4);
}

function contrast(first: number, second: number): number {
  const [light, dark] = first > second ? [first, second] : [second, first];
  return (light + CONTRAST_OFFSET) / (dark + CONTRAST_OFFSET);
}

export function labelColors(color: string): { background: string; text: "#000000" | "#ffffff" } {
  const hex = HEX_COLOR.exec(color)?.[1] ?? FALLBACK_COLOR;
  const background = luminance(hex);
  const onBlack = contrast(background, BLACK_LUMINANCE);
  const onWhite = contrast(background, WHITE_LUMINANCE);
  return { background: `#${hex}`, text: onBlack >= onWhite ? "#000000" : "#ffffff" };
}
