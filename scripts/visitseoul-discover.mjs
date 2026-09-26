#!/usr/bin/env node
/**
 * 发现工具：按分类路径抓一页列表，用于挑选「年轻人向」首尔地点。
 *
 * 用法：
 *   node scripts/visitseoul-discover.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "./visitseoul-fetch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_PATHS = [
  "Culture > Cultural Districts",
  "Culture > Parks",
  "Nature > Natural Sites(Parks)",
  "Nature > Natural Sites(Rivers)",
  "Shopping > Shopping Malls & Outlets",
  "Shopping > Specialty Shops & Stores",
  "Shopping > Traditional Markets",
];
const KEYWORDS = /明洞|东大门|梨泰院|弘大|江南|汉江|公园|大桥|桥|广场|市场|夜景|喷泉|塔|岛|街|路|购物|百货|免税|COEX|乐天|屋顶|咖啡|夜市|城|村/;

function loadEnv() {
  const env = {};
  for (const line of readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const apiKey = env.VISITSEOUL_API_KEY;
  if (!apiKey) {
    console.error("缺少 VISITSEOUL_API_KEY");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : "";
  };
  const keyword = flag("--keyword");
  const pathFilter = flag("--path");
  const targetPaths = pathFilter ? [pathFilter] : TARGET_PATHS;
  const cats = await request(apiKey, "/category/list", {
    query: { lang_code_id: "en" },
    throwOnError: true,
  });
  const list = Array.isArray(cats?.data) ? cats.data : [];
  for (const target of targetPaths) {
    const cat = list.find((c) => (c.ctgry_path || "").trim() === target);
    if (!cat) {
      console.log(`\n=== ${target} === 未找到`);
      continue;
    }
    await new Promise((r) => setTimeout(r, 500));
    const json = await request(apiKey, "/contents/list", {
      method: "POST",
      body: {
        com_ctgry_sn: cat.com_ctgry_sn,
        lang_code_id: "zh-CN",
        keyword: keyword,
        sort_type: "latest",
        page_no: 1,
      },
      throwOnError: true,
    });
    const items = Array.isArray(json?.data) ? json.data : [];
    const total = json?.paging?.total_count ?? items.length;
    console.log(`\n=== ${target} (${cat.com_ctgry_sn}) total=${total} ===`);
    const matched = keyword ? items : items.filter((x) => KEYWORDS.test(x.post_sj || ""));
    const rest = keyword ? [] : items.filter((x) => !KEYWORDS.test(x.post_sj || ""));
    matched.forEach((x) => console.log(`${x.cid} | ${x.post_sj}`));
    if (matched.length < 12) {
      rest.slice(0, 12 - matched.length).forEach((x) => console.log(`${x.cid} | ${x.post_sj}`));
    }
  }
}

main().catch((err) => {
  console.error("[discover] 失败：", err.message);
  process.exit(1);
});
