/* 计薪引擎自检：node scripts/check-calc.cjs
 *
 * 前置：pnpm check:calc 会先跑 tsc -p tsconfig.check.json 把 src/core 编到 .check/core
 */
"use strict";

const path = require("node:path");
const { run } = require("./lib/checks.cjs");

const CORE = path.join(__dirname, "..", ".check", "core");

if (!require("node:fs").existsSync(path.join(CORE, "pay.js"))) {
  console.error("缺少 .check/core：请先运行 tsc -p tsconfig.check.json");
  process.exit(1);
}

const engine = {
  pay: require(path.join(CORE, "pay.js")),
  types: require(path.join(CORE, "types.js")),
  format: require(path.join(CORE, "format.js")),
  holidays: require(path.join(CORE, "holidays.js")),
};

const results = run(engine);
let failed = 0;

console.log("计薪引擎自检");
for (const r of results) {
  if (r.ok) {
    console.log(`  ok  ${r.name}`);
  } else {
    failed++;
    console.error(`FAIL  ${r.name}`);
    console.error(`      ${r.message}`);
  }
}

console.log(`\n通过 ${results.length - failed} / ${results.length} 项`);
if (failed > 0) process.exitCode = 1;
