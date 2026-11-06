/* 变异测试：node scripts/check-mutation.cjs
 *
 * 目的：证明自检不是「恒真断言」。故意把引擎改坏一处，
 *      如果自检仍有全绿，说明测试没测到那段逻辑 → 报「变异存活」并失败。
 *
 * 做法：把 .check/lib 复制到 .check/mutant，做一处文本替换，
 *      用同一套脚本内的断言集（scripts/lib/checks.cjs）跑一遍，要求至少挂一条。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { run } = require("./lib/checks.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, ".check", "core");
const WORK = path.join(ROOT, ".check", "mutant");

const MUTATIONS = [
  {
    id: "M1",
    file: "pay.js",
    desc: "休息日上的法定节假日不再计入计薪天数",
    find: "if (holidayName) {",
    replace: "if (false) {",
  },
  {
    id: "M2",
    file: "pay.js",
    desc: "节假日 / 下班后不再返回整日工资",
    find: "earned: dailyWage,",
    replace: "earned: dailyWage * 0.9,",
  },
  {
    id: "M3",
    file: "pay.js",
    desc: "下班边界 >= 放宽成 >（18:00 整仍算工作中）",
    find: "if (nowSecond >= end) {",
    replace: "if (nowSecond > end) {",
  },
  {
    id: "M4",
    file: "pay.js",
    desc: "午休不再扣除（全天连续计薪）",
    find: "if (settings.lunchEnabled) {",
    replace: "if (false) {",
  },
  {
    id: "M5",
    file: "format.js",
    desc: "金额改成四舍五入",
    find: "Math.floor(value * factor + 1e-6)",
    replace: "Math.round(value * factor)",
  },
];

if (!fs.existsSync(path.join(SRC, "pay.js"))) {
  console.error("缺少 .check/core：请先运行 tsc -p tsconfig.check.json");
  process.exit(1);
}

function copyLib() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  for (const f of fs.readdirSync(SRC)) {
    if (f.endsWith(".js")) fs.copyFileSync(path.join(SRC, f), path.join(WORK, f));
  }
}

function loadEngine(dir) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(dir)) delete require.cache[key];
  }
  return {
    pay: require(path.join(dir, "pay.js")),
    types: require(path.join(dir, "types.js")),
    format: require(path.join(dir, "format.js")),
    holidays: require(path.join(dir, "holidays.js")),
  };
}

// ── 对照组：原始引擎必须全绿，否则后面「变异后变红」没有意义 ──
copyLib();
const control = run(loadEngine(WORK));
const controlFailed = control.filter((r) => !r.ok);
if (controlFailed.length > 0) {
  console.error("对照组失败：未经变异的引擎就无法通过自检，先修引擎。");
  for (const r of controlFailed) console.error(`  FAIL ${r.name}\n       ${r.message}`);
  process.exit(1);
}
console.log(`对照组：${control.length} 项断言全绿`);

// ── 逐个变异 ──
let survivors = 0;
let broken = 0;

for (const m of MUTATIONS) {
  copyLib();
  const file = path.join(WORK, m.file);
  const before = fs.readFileSync(file, "utf8");

  if (!before.includes(m.find)) {
    broken++;
    console.error(`FAIL ${m.id} 变异点未找到（${m.file} 里没有 «${m.find}»）——引擎若已重构，请同步更新变异表`);
    continue;
  }

  fs.writeFileSync(file, before.replace(m.find, m.replace), "utf8");

  let results;
  try {
    results = run(loadEngine(WORK));
  } catch (err) {
    // 引擎被改坏到抛异常，也算被测试发现
    console.log(`  ok  ${m.id} ${m.desc} → 引擎抛错（${err && err.message ? err.message : err}）`);
    continue;
  }

  const killed = results.filter((r) => !r.ok);
  if (killed.length === 0) {
    survivors++;
    console.error(`FAIL ${m.id} 变异存活：${m.desc}（自检没测到）`);
  } else {
    console.log(`  ok  ${m.id} ${m.desc} → 挂掉 ${killed.length} 项`);
    for (const r of killed.slice(0, 3)) console.log(`        · ${r.name}：${r.message}`);
    if (killed.length > 3) console.log(`        · …另有 ${killed.length - 3} 项`);
  }
}

fs.rmSync(WORK, { recursive: true, force: true });

console.log("");
if (survivors > 0 || broken > 0) {
  console.error(`变异测试失败：存活 ${survivors} 个，失效变异点 ${broken} 个`);
  process.exitCode = 1;
} else {
  console.log(`变异测试通过：${MUTATIONS.length} 个变异全部被自检发现`);
}
