// tsc 输出的 .js 是 CommonJS，但 package.json 里 type=module，
// 这里补一个标记文件让 Node 按 CJS 解析。
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync(".check", { recursive: true });
writeFileSync(".check/package.json", '{ "type": "commonjs" }\n');
console.log("ok: .check/package.json");
