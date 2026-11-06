import { chromium } from "playwright-core";

const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const height = Number(process.argv[2] ?? 212);
const browser = await chromium.launch({
  executablePath: edge,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 380, height },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.goto("http://127.0.0.1:4173/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const rects = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
  };
  return {
    card: pick(".card"),
    status: pick(".status"),
    track: pick(".track"),
    scale: pick(".scale"),
    stats: pick(".stats"),
    scrollHeight: document.querySelector(".card")?.scrollHeight,
  };
});
console.log(JSON.stringify(rects, null, 2));
await page.screenshot({ path: `shots/widget-h${height}.png` });
await browser.close();
