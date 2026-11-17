import { describe, expect, it } from "vitest";
import jobLog from "./fixtures/job-log.txt?raw";
import { parseLog, type LogBlock, type LogSpan } from "./log";

const PLAIN = { fg: null, bg: null, bold: false, italic: false, underline: false };

function span(text: string, style: Partial<Omit<LogSpan, "text">> = {}): LogSpan {
  return { text, ...PLAIN, ...style };
}

function lineAt(blocks: readonly LogBlock[], index: number) {
  const block = blocks[index];
  if (block?.kind !== "line") throw new Error(`Block ${String(index)} is not a line`);
  return block.line;
}

describe("parseLog", () => {
  const blocks = parseLog(jobLog);

  it("folds groups, drops endgroup markers and keeps numbering consecutive", () => {
    expect(blocks.map((block) => block.kind)).toEqual([
      "group",
      "line",
      "line",
      "line",
      "line",
      "line",
      "line",
      "group",
    ]);
    expect(blocks[0]).toEqual({
      kind: "group",
      group: {
        title: "Run actions/checkout@v5",
        startLine: 1,
        lines: [
          { number: 2, spans: [span("with:")], timestamp: "2026-11-17T09:58:12.1240000Z" },
          {
            number: 3,
            spans: [span("  repository: octo-org/hello-mobile")],
            timestamp: "2026-11-17T09:58:12.1241000Z",
          },
        ],
      },
    });
    expect(lineAt(blocks, 1).number).toBe(4);
    const last = blocks[7];
    expect(last?.kind === "group" && last.group).toMatchObject({
      title: "Post job cleanup",
      startLine: 10,
      lines: [{ number: 11, spans: [span("Cleaning up orphan processes")] }],
    });
  });

  it("keeps command and error markers as text with timestamps split off", () => {
    expect(lineAt(blocks, 2)).toEqual({
      number: 5,
      spans: [span("##[command]/usr/bin/pnpm test")],
      timestamp: "2026-11-17T09:58:15.2000000Z",
    });
    expect(lineAt(blocks, 6).spans).toEqual([span("##[error]Process completed with exit code 1.")]);
  });

  it("maps 16-color, bold, underline and reset codes", () => {
    expect(lineAt(blocks, 1).spans).toEqual([
      span("pnpm test", { fg: "var(--ghm-ansi-6, #11a8cd)", bold: true }),
    ]);
    expect(lineAt(blocks, 3).spans).toEqual([
      span("✓", { fg: "var(--ghm-ansi-2, #0dbc79)" }),
      span(" src/greeting.test.ts (4 tests)"),
    ]);
    expect(lineAt(blocks, 4).spans).toEqual([
      span("×", { fg: "var(--ghm-ansi-1, #cd3131)" }),
      span(" src/shout.test.ts "),
      span("shouts", { bold: true, underline: true }),
    ]);
  });

  it("maps 256-color and truecolor codes", () => {
    expect(lineAt(blocks, 5).spans).toEqual([
      span("warning", { fg: "#ff8700" }),
      span(" "),
      span("truecolor", { bg: "#282c34" }),
    ]);
    const [bright, cube, gray, low] = parseLog(
      "\u001b[91;103ma\u001b[0m\u001b[38;5;16mb\u001b[38;5;244mc\u001b[48;5;4md",
    ).flatMap((block) => (block.kind === "line" ? block.line.spans : []));
    expect(bright).toMatchObject({
      fg: "var(--ghm-ansi-9, #f14c4c)",
      bg: "var(--ghm-ansi-11, #f5f543)",
    });
    expect(cube?.fg).toBe("#000000");
    expect(gray?.fg).toBe("#808080");
    expect(low?.bg).toBe("var(--ghm-ansi-4, #2472c8)");
  });

  it("applies italic, default colors and drops non-color sequences", () => {
    const [line] = parseLog("\u001b[3;31mi\u001b[39;23mn\u001b[2K\u001b[1Gx");
    expect(line?.kind === "line" && line.line.spans).toEqual([
      span("i", { italic: true, fg: "var(--ghm-ansi-1, #cd3131)" }),
      span("nx"),
    ]);
  });

  it("drops charset, OSC and other non-CSI escapes", () => {
    const [line] = parseLog(
      "\u001b(Ba\u001b]0;title\u0007b\u001b]8;;https://x\u001b\\c\u001b=d\u001b[1me",
    );
    expect(line?.kind === "line" && line.line.spans).toEqual([
      span("abcd"),
      span("e", { bold: true }),
    ]);
  });

  it("returns lines without timestamps and handles CRLF and an empty log", () => {
    expect(parseLog("plain\r\n\r\nlast")).toEqual([
      { kind: "line", line: { number: 1, spans: [span("plain")], timestamp: null } },
      { kind: "line", line: { number: 2, spans: [], timestamp: null } },
      { kind: "line", line: { number: 3, spans: [span("last")], timestamp: null } },
    ]);
    expect(parseLog("")).toEqual([]);
  });
});
