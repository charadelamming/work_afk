/* 视觉验收：用系统自带 Edge 渲染并截图
 * node scripts/shot.mjs [baseUrl]
 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:4173";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

const browser = await chromium.launch({
  executablePath: edge,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
});

async function shot({ url, file, viewport, at, fullPage = false, scrollBody = false, showStats = false }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const page = await context.newPage();
  if (showStats) {
    await page.addInitScript(() => {
      localStorage.setItem("reborn-work.settings", JSON.stringify({ showStats: true }));
    });
  }
  if (at) {
    await page.addInitScript((iso) => {
      const RealDate = Date;
      const fixed = new RealDate(iso).getTime();
      class FakeDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [fixed]));
        }
        static now() {
          return fixed;
        }
      }
      // @ts-ignore
      window.Date = FakeDate;
    }, at);
  }
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  if (scrollBody) {
    await page.evaluate(() => {
      const scope = document.querySelector(".set-body");
      if (scope) scope.scrollTop = scope.scrollHeight;
    });
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: file, fullPage });
  await context.close();
  console.log("saved", file);
}

await shot({ url: "/index.html", file: "shots/widget-working.png", viewport: { width: 380, height: 172 } });
await shot({
  url: "/index.html",
  file: "shots/widget-before.png",
  viewport: { width: 380, height: 172 },
  at: "2026-11-03T08:00:00+08:00",
});
await shot({
  url: "/index.html",
  file: "shots/widget-lunch.png",
  viewport: { width: 380, height: 172 },
  at: "2026-11-03T12:30:00+08:00",
});
await shot({
  url: "/index.html",
  file: "shots/widget-after.png",
  viewport: { width: 380, height: 172 },
  at: "2026-11-03T19:10:00+08:00",
});
await shot({
  url: "/index.html",
  file: "shots/widget-holiday.png",
  viewport: { width: 380, height: 172 },
  at: "2026-10-01T10:00:00+08:00",
});
await shot({
  url: "/index.html",
  file: "shots/widget-rest.png",
  viewport: { width: 380, height: 172 },
  at: "2026-11-08T10:00:00+08:00",
});
await shot({
  url: "/index.html",
  file: "shots/widget-stats.png",
  viewport: { width: 380, height: 212 },
  at: "2026-11-09T16:00:00+08:00",
  showStats: true,
});
await shot({ url: "/settings.html", file: "shots/settings.png", viewport: { width: 820, height: 760 } });
await shot({
  url: "/settings.html",
  file: "shots/settings-bottom.png",
  viewport: { width: 820, height: 760 },
  scrollBody: true,
});
await shot({
  url: "/settings.html",
  file: "shots/settings-full.png",
  viewport: { width: 820, height: 1240 },
});

await browser.close();
