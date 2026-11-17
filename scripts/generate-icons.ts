import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const ICON_BACKGROUND = "#3D7BFF";
const MASKABLE_INSET_RATIO = 0.1;
const icons = [
  { filename: "icon-192.png", size: 192, maskable: false },
  { filename: "icon-512.png", size: 512, maskable: false },
  { filename: "icon-maskable-512.png", size: 512, maskable: true },
  { filename: "apple-touch-icon.png", size: 180, maskable: false },
];
const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of icons) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    const padding = icon.maskable ? icon.size * MASKABLE_INSET_RATIO : 0;
    await page.setContent(
      `<html><head><style>html,body{margin:0;width:100%;height:100%;background:${ICON_BACKGROUND}}body{box-sizing:border-box;padding:${String(padding)}px}svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`,
    );
    await page.screenshot({
      path: new URL(`../public/${icon.filename}`, import.meta.url).pathname,
    });
  }
} finally {
  await browser.close();
}
