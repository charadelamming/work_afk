/* 布局核查：设置页 820×760（内滚 + 底部操作条）与小组件 380×212 的溢出 / 遮挡 / 横向滚动 */
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:4173";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await chromium.launch({
  executablePath: edge,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
});

async function newPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(`console: ${m.text()}`);
  });
  return { context, page, errors };
}

const measure = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), height: +r.height.toFixed(1) };
    };
    const scope = document.querySelector(".set-body");
    const panels = [...document.querySelectorAll(".panel")];
    const foot = document.querySelector(".set-foot");
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      scope: scope
        ? {
            scrollTop: scope.scrollTop,
            scrollHeight: scope.scrollHeight,
            clientHeight: scope.clientHeight,
            scrollWidth: scope.scrollWidth,
            clientWidth: scope.clientWidth,
          }
        : null,
      bodyBox: box(scope),
      footBox: box(foot),
      firstPanel: box(panels[0]),
      lastPanel: box(panels[panels.length - 1]),
      panelCount: panels.length,
    };
  });

const report = [];

// 设置页：真实窗口尺寸 820×760
{
  const { context, page, errors } = await newPage({ width: 820, height: 760 });
  await page.goto(`${base}/settings.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const top = await measure(page);
  await page.screenshot({ path: "shots/settings.png" });

  await page.evaluate(() => {
    const scope = document.querySelector(".set-body");
    scope.scrollTop = scope.scrollHeight;
  });
  await page.waitForTimeout(300);
  const bottom = await measure(page);
  await page.screenshot({ path: "shots/settings-bottom.png" });

  // 遮挡判定：内容可视区底边不得越过操作条顶边
  const overlap = bottom.lastPanel.bottom > bottom.footBox.top + 0.5;
  const noHorizontalScroll = top.docScrollWidth <= top.docClientWidth;
  report.push({ page: "settings-820x760", top, bottom, overlap, noHorizontalScroll, errors });
  await context.close();
}

// 设置页：整页（高视口，供 README 展示）
{
  const { context, page, errors } = await newPage({ width: 820, height: 1240 });
  await page.goto(`${base}/settings.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const info = await measure(page);
  await page.screenshot({ path: "shots/settings-full.png" });
  report.push({ page: "settings-820x1240", info, errors });
  await context.close();
}

// 小组件
{
  const { context, page, errors } = await newPage({ width: 380, height: 212 });
  await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const card = document.querySelector(".card");
    const r = card ? card.getBoundingClientRect() : null;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      card: r ? { top: r.top, left: r.left, bottom: r.bottom, right: r.right } : null,
      statsBottom: document.querySelector(".stats")?.getBoundingClientRect().bottom ?? null,
    };
  });
  report.push({ page: "widget", info, errors });
  await context.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
