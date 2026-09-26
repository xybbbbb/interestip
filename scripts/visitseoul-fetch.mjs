#!/usr/bin/env node
import { pathToFileURL } from "node:url";

/**
 * VisitSeoul OpenAPI 抓取脚本骨架（零第三方依赖，Node 20+）
 *
 * 用法：
 *   node visitseoul-fetch.mjs langs
 *   node visitseoul-fetch.mjs categories [--lang en]
 *   node visitseoul-fetch.mjs list --category <com_ctgry_sn> [--lang en] [--keyword xxx] [--page 1] [--max-pages 3] [--json out.json]
 *   node visitseoul-fetch.mjs info <cid> [--lang en] [--json out.json]
 *
 * 环境变量：
 *   VISITSEOUL_API_KEY  必填，认证 Header
 *   VISITSEOUL_BASE     可选，默认 https://api-call.visitseoul.net/api/v1
 *
 * 说明：拿到 Key 后先跑 langs / categories 核对字段，再小批量试 list / info，
 * 确认响应结构与 docs/visitseoul-fields.md 一致后再做批量导入。
 */

const BASE_URL = process.env.VISITSEOUL_BASE || "https://api-call.visitseoul.net/api/v1";

function printUsage() {
  console.log(`VisitSeoul 抓取脚本

用法:
  node visitseoul-fetch.mjs langs
  node visitseoul-fetch.mjs categories [--lang en]
  node visitseoul-fetch.mjs list --category <com_ctgry_sn> [--lang en] [--keyword xxx] [--page 1] [--max-pages 3] [--json out.json]
  node visitseoul-fetch.mjs info <cid> [--lang en] [--json out.json]

环境变量:
  VISITSEOUL_API_KEY  必填
  VISITSEOUL_BASE     可选，默认 ${BASE_URL}`);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      flags[key] = value;
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function requireApiKey() {
  const key = process.env.VISITSEOUL_API_KEY;
  if (!key) {
    console.error("[visitseoul-fetch] 缺少 VISITSEOUL_API_KEY 环境变量。");
    printUsage();
    process.exit(2);
  }
  return key;
}

async function request(apiKey, path, { method = "GET", body, query = {}, throwOnError = false } = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers = {
    "VISITSEOUL-API-KEY": apiKey,
    Accept: "application/json;charset=UTF-8",
    "Content-Type": "application/json;charset=UTF-8",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = { raw: await res.text().catch(() => "") };
  }

  if (!res.ok) {
    const message = `HTTP ${res.status}: ${JSON.stringify(json)}`;
    if (throwOnError) throw new Error(message);
    console.error(`[visitseoul-fetch] HTTP ${res.status}`, JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const code = json?.result_code ?? "SUCCESS";
  const message = json?.result_message ?? "OK";
  if (code !== "SUCCESS" && code !== 200) {
    if (throwOnError) throw new Error(`接口返回错误 ${code}: ${message}`);
    console.error(`[visitseoul-fetch] 接口返回错误 ${code}: ${message}`);
    console.error(JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

async function fetchLanguages(apiKey) {
  const json = await request(apiKey, "/code/lang");
  const list = Array.isArray(json?.data) ? json.data : json?.data?.list ?? [];
  console.log(JSON.stringify(list, null, 2));
}

async function fetchCategories(apiKey, lang) {
  const json = await request(apiKey, "/category/list", {
    query: lang ? { lang_code_id: lang } : {},
  });
  const list = Array.isArray(json?.data) ? json.data : json?.data?.list ?? [];
  console.log(JSON.stringify(list, null, 2));
}

async function listContents(apiKey, { category, lang, keyword, page = 1, maxPages = 3 }) {
  const body = {
    com_ctgry_sn: category,
    lang_code_id: lang,
    keyword: keyword || "",
    sort_type: "latest",
    page_no: page,
  };
  const json = await request(apiKey, "/contents/list", { method: "POST", body });

  const paging = json?.paging ?? {};
  const totalCount = paging.total_count ?? 0;
  const pageSize = paging.page_size ?? 50;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const items = [];
  const firstPageItems = Array.isArray(json?.data) ? json.data : json?.data?.items ?? [];
  items.push(...firstPageItems);

  const usableMax = maxPages === Infinity ? totalPages : Math.min(maxPages ?? totalPages, totalPages);
  for (let p = page + 1; p <= usableMax && items.length < totalCount; p += 1) {
    // 官方文档未给出明确限速，先保守等待，避免触发限流；拿到实测后可调整
    await new Promise((resolve) => setTimeout(resolve, 300));
    const nextBody = { ...body, page_no: p };
    const next = await request(apiKey, "/contents/list", { method: "POST", body: nextBody });
    const nextItems = Array.isArray(next?.data) ? next.data : next?.data?.items ?? [];
    items.push(...nextItems);
  }

  return items;
}

async function fetchInfo(apiKey, cid, lang) {
  const body = { cid };
  if (lang) body.lang_code_id = lang;
  const json = await request(apiKey, "/contents/info", { method: "POST", body });
  return json;
}

async function writeJsonFile(path, data) {
  const fs = await import("node:fs");
  fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  console.log(`[visitseoul-fetch] 已写入 ${path}`);
}

async function main() {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const command = positional[0];
  if (!command) {
    printUsage();
    return;
  }
  const apiKey = requireApiKey();

  if (command === "langs") {
    await fetchLanguages(apiKey);
    return;
  }

  if (command === "categories") {
    await fetchCategories(apiKey, flags.lang);
    return;
  }

  if (command === "list") {
    if (!flags.category) {
      console.error("[list] 缺少 --category，请先用 categories 命令拿 com_ctgry_sn。");
      process.exit(2);
    }
    const items = await listContents(apiKey, {
      category: flags.category,
      lang: flags.lang,
      keyword: flags.keyword,
      page: Number(flags.page || 1),
      maxPages: flags["max-pages"] === undefined ? 3 : Number(flags["max-pages"]),
    });
    if (flags.json) {
      console.error(`[list] 已写入 ${items.length} 条到 ${flags.json}`);
      writeJsonFile(flags.json, items);
    } else {
      console.log(JSON.stringify(items, null, 2));
    }
    return;
  }

  if (command === "info") {
    const cid = positional[1];
    if (!cid) {
      console.error("[info] 缺少 cid，例如：node visitseoul-fetch.mjs info ENPsrn1p5");
      process.exit(2);
    }
    const detail = await fetchInfo(apiKey, cid, flags.lang);
    if (flags.json) {
      console.error(`[info] 已写入 ${flags.json}`);
      writeJsonFile(flags.json, detail);
    } else {
      console.log(JSON.stringify(detail, null, 2));
    }
    return;
  }

  printUsage();
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[visitseoul-fetch] 执行失败：", err);
    process.exit(1);
  });
}

export { request };
