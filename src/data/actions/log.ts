export interface LogSpan {
  text: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface LogLine {
  number: number;
  spans: readonly LogSpan[];
  timestamp: string | null;
}

export interface LogGroup {
  title: string;
  startLine: number;
  lines: readonly LogLine[];
}

export type LogBlock = { kind: "line"; line: LogLine } | { kind: "group"; group: LogGroup };

type SpanStyle = Omit<LogSpan, "text">;

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?/;
const BYTE_ORDER_MARK = "\uFEFF";
const LINE_BREAK = /\r?\n/;
const GROUP_START = "##[group]";
const GROUP_END = "##[endgroup]";
const ESCAPE = "\u001b";
const CONTROL_SEQUENCE = "[";
const OPERATING_SYSTEM_COMMAND = "]";
const BELL = "\u0007";
const STRING_TERMINATOR = "\u001b\\";
const FINAL_BYTE_MIN = 0x40;
const INTERMEDIATE_BYTE_MIN = 0x20;
const INTERMEDIATE_BYTE_MAX = 0x2f;
const PLAIN: SpanStyle = {
  fg: null,
  bg: null,
  bold: false,
  italic: false,
  underline: false,
};

const BASIC_PALETTE = [
  "#000000",
  "#cd3131",
  "#0dbc79",
  "#e5e510",
  "#2472c8",
  "#bc3fbc",
  "#11a8cd",
  "#e5e5e5",
  "#666666",
  "#f14c4c",
  "#23d18b",
  "#f5f543",
  "#3b8eea",
  "#d670d6",
  "#29b8db",
  "#e5e5e5",
];
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const CUBE_START = 16;
const GRAY_START = 232;
const GRAY_BASE = 8;
const GRAY_STEP = 10;
const CUBE_SIDE = CUBE_LEVELS.length;
const PALETTE_MAX = 255;
const MAX_CHANNEL = 255;
const SGR = {
  reset: 0,
  bold: 1,
  italic: 3,
  underline: 4,
  normalWeight: 22,
  notItalic: 23,
  notUnderlined: 24,
  fgFirst: 30,
  fgLast: 37,
  fgExtended: 38,
  fgDefault: 39,
  bgFirst: 40,
  bgLast: 47,
  bgExtended: 48,
  bgDefault: 49,
  brightFgFirst: 90,
  brightFgLast: 97,
  brightBgFirst: 100,
  brightBgLast: 107,
  palette: 5,
  rgb: 2,
} as const;
const BRIGHT_OFFSET = 8;

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => Math.min(MAX_CHANNEL, Math.max(0, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function basicColor(index: number): string {
  return `var(--ghm-ansi-${String(index)}, ${BASIC_PALETTE[index] ?? "currentColor"})`;
}

function paletteColor(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > PALETTE_MAX) return null;
  if (index < CUBE_START) return basicColor(index);
  if (index >= GRAY_START) {
    const level = GRAY_BASE + (index - GRAY_START) * GRAY_STEP;
    return hex(level, level, level);
  }
  const cube = index - CUBE_START;
  const level = (step: number): number => CUBE_LEVELS[step] ?? 0;
  return hex(
    level(Math.floor(cube / CUBE_SIDE ** 2)),
    level(Math.floor(cube / CUBE_SIDE) % CUBE_SIDE),
    level(cube % CUBE_SIDE),
  );
}

function extendedColor(codes: readonly number[], start: number): [string | null, number] {
  const mode = codes[start];
  if (mode === SGR.palette) return [paletteColor(codes[start + 1] ?? -1), 2];
  if (mode === SGR.rgb) {
    const [red = 0, green = 0, blue = 0] = codes.slice(start + 1, start + 4);
    return [hex(red, green, blue), 4];
  }
  return [null, 1];
}

function applySgr(style: SpanStyle, parameters: string): SpanStyle {
  const codes = parameters.split(";").map(Number);
  let next = style;
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index] ?? SGR.reset;
    if (code === SGR.reset) next = PLAIN;
    else if (code === SGR.bold) next = { ...next, bold: true };
    else if (code === SGR.italic) next = { ...next, italic: true };
    else if (code === SGR.underline) next = { ...next, underline: true };
    else if (code === SGR.normalWeight) next = { ...next, bold: false };
    else if (code === SGR.notItalic) next = { ...next, italic: false };
    else if (code === SGR.notUnderlined) next = { ...next, underline: false };
    else if (code >= SGR.fgFirst && code <= SGR.fgLast) {
      next = { ...next, fg: basicColor(code - SGR.fgFirst) };
    } else if (code >= SGR.brightFgFirst && code <= SGR.brightFgLast) {
      next = { ...next, fg: basicColor(code - SGR.brightFgFirst + BRIGHT_OFFSET) };
    } else if (code >= SGR.bgFirst && code <= SGR.bgLast) {
      next = { ...next, bg: basicColor(code - SGR.bgFirst) };
    } else if (code >= SGR.brightBgFirst && code <= SGR.brightBgLast) {
      next = { ...next, bg: basicColor(code - SGR.brightBgFirst + BRIGHT_OFFSET) };
    } else if (code === SGR.fgDefault) next = { ...next, fg: null };
    else if (code === SGR.bgDefault) next = { ...next, bg: null };
    else if (code === SGR.fgExtended || code === SGR.bgExtended) {
      const [color, consumed] = extendedColor(codes, index + 1);
      next = code === SGR.fgExtended ? { ...next, fg: color } : { ...next, bg: color };
      index += consumed;
    }
  }
  return next;
}

function skipBytes(text: string, from: number, min: number, max: number): number {
  let index = from;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code < min || code > max) break;
    index++;
  }
  return index;
}

function escapeSequence(text: string, escape: number): { end: number; sgr: string | null } {
  const kind = text.charAt(escape + 1);
  if (kind === CONTROL_SEQUENCE) {
    const final = skipBytes(text, escape + 2, 0, FINAL_BYTE_MIN - 1);
    const sgr = text.charAt(final) === "m" ? text.slice(escape + 2, final) : null;
    return { end: final + 1, sgr };
  }
  if (kind === OPERATING_SYSTEM_COMMAND) {
    const bell = text.indexOf(BELL, escape);
    const terminator = text.indexOf(STRING_TERMINATOR, escape + 1);
    const ends = [bell + BELL.length, terminator + STRING_TERMINATOR.length].filter(
      (end) => end > escape + 1,
    );
    return { end: ends.length > 0 ? Math.min(...ends) : text.length, sgr: null };
  }
  const final = skipBytes(text, escape + 1, INTERMEDIATE_BYTE_MIN, INTERMEDIATE_BYTE_MAX);
  return { end: final + 1, sgr: null };
}

function sameStyle(left: SpanStyle, right: SpanStyle): boolean {
  return (
    left.fg === right.fg &&
    left.bg === right.bg &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline
  );
}

// Match GitHub's line-local coloring.
function spansOf(text: string): LogSpan[] {
  const spans: LogSpan[] = [];
  let style = PLAIN;
  let cursor = 0;
  const pushText = (end: number): void => {
    if (end <= cursor) return;
    const last = spans.at(-1);
    // Avoid fragmenting identical styled spans.
    if (last && sameStyle(last, style)) last.text += text.slice(cursor, end);
    else spans.push({ text: text.slice(cursor, end), ...style });
  };
  for (;;) {
    const escape = text.indexOf(ESCAPE, cursor);
    if (escape < 0) break;
    pushText(escape);
    const sequence = escapeSequence(text, escape);
    if (sequence.sgr !== null) style = applySgr(style, sequence.sgr);
    cursor = sequence.end;
  }
  pushText(text.length);
  return spans;
}

export function parseLog(text: string): readonly LogBlock[] {
  const blocks: LogBlock[] = [];
  const body = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  const rawLines = body.split(LINE_BREAK);
  if (rawLines.at(-1) === "") rawLines.pop();
  let group: { title: string; startLine: number; lines: LogLine[] } | null = null;
  let number = 0;
  for (const raw of rawLines) {
    const timestamp = TIMESTAMP.exec(raw);
    const content = timestamp ? raw.slice(timestamp[0].length) : raw;
    if (content.startsWith(GROUP_END)) {
      group = null;
      continue;
    }
    number++;
    if (content.startsWith(GROUP_START)) {
      const title = spansOf(content.slice(GROUP_START.length))
        .map((span) => span.text)
        .join("");
      // GitHub groups cannot nest.
      group = { title, startLine: number, lines: [] };
      blocks.push({ kind: "group", group });
      continue;
    }
    const line: LogLine = { number, spans: spansOf(content), timestamp: timestamp?.[1] ?? null };
    if (group) group.lines.push(line);
    else blocks.push({ kind: "line", line });
  }
  return blocks;
}
