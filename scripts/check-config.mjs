// 用官方 JSON Schema 做一次轻量校验：主要抓拼错的字段名
import { readFileSync } from "node:fs";

const schema = await (await fetch("https://schema.tauri.app/config/2")).json();
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));

const problems = [];

function resolve(node) {
  let guard = 0;
  while (node && node.$ref && guard++ < 20) {
    const parts = node.$ref.replace(/^#\//, "").split("/");
    node = parts.reduce((acc, key) => acc?.[key], schema);
  }
  return node;
}

function collectProps(node) {
  node = resolve(node);
  if (!node) return null;
  const branches = node.anyOf ?? node.oneOf;
  if (branches) {
    const merged = {};
    let known = false;
    for (const branch of branches) {
      const props = collectProps(branch);
      if (props) {
        Object.assign(merged, props.properties ?? {});
        known = true;
      }
    }
    return known ? { ...node, properties: { ...merged, ...(node.properties ?? {}) } } : null;
  }
  return node;
}

function walk(value, node, path) {
  node = collectProps(node);
  if (!node) return;
  if (node.type === "array" && Array.isArray(value)) {
    if (node.items) value.forEach((item, i) => walk(item, node.items, `${path}[${i}]`));
    return;
  }
  if (node.properties && value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      if (!(key in node.properties)) {
        problems.push(`${path}.${key} 不在允许字段里`);
      } else {
        walk(value[key], node.properties[key], `${path}.${key}`);
      }
    }
  }
}

walk(config, schema, "config");
if (problems.length) {
  console.log("发现问题：");
  problems.forEach((p) => console.log(" -", p));
  process.exitCode = 1;
} else {
  console.log("tauri.conf.json 字段校验通过");
}
