#!/usr/bin/env node
/**
 * 从 VisitSeoul OpenAPI 抓取「Culture > Landmarks（地标）」分类并转换成项目数据格式。
 *
 * 产物：
 *   data/visitseoul-landmarks.json   （demo:false，官方真实数据）
 *
 * 用法：
 *   node scripts/visitseoul-build-landmarks.mjs
 *
 * 说明：
 *   - 语言：主记录 zh-CN（展示名/地址/简介），另抓 ko 详情补 nameLocal（韩文名）。
 *   - 分类 ID 每次从 /category/list 动态获取，不硬编码。
 *   - 坐标来自 traffic.map_position_x/y，转换后做范围校验。
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "./visitseoul-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "visitseoul-landmarks.json");
const DISPLAY_LANG = "zh-CN";
const LOCAL_LANG = "ko";
const CONCURRENCY = 1;
const REQUEST_GAP_MS = 500;

function loadEnv() {
  const env = {};
  const file = path.join(ROOT, ".env");
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function text(v) {
  return typeof v === "string" ? v : "";
}

function stripHtml(s) {
  return text(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

async function retry(fn, tries = 4) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (/接口返回错误 611/.test(err.message)) throw err;
      if (attempt < tries) {
        const delayMs = 1200 * attempt;
        console.error(`[build-landmarks] 请求失败，${delayMs}ms 后重试（${attempt}/${tries - 1}）…`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

async function findLandmarkCategory(apiKey) {
  const json = await request(apiKey, "/category/list", {
    query: { lang_code_id: "en" },
    throwOnError: true,
  });
  const list = Array.isArray(json?.data) ? json.data : [];
  return list.find(
    (c) => c.ctgry_nm === "Landmarks" && (c.ctgry_path || "").trim() === "Culture > Landmarks"
  );
}

async function listAllContents(apiKey, category, lang) {
  const body = {
    com_ctgry_sn: category.com_ctgry_sn,
    lang_code_id: lang,
    keyword: "",
    sort_type: "latest",
    page_no: 1,
  };
  const first = await request(apiKey, "/contents/list", { method: "POST", body, throwOnError: true });
  const firstItems = Array.isArray(first?.data)
    ? first.data
    : Array.isArray(first?.data?.items)
      ? first.data.items
      : [];
  const items = [...firstItems];
  const paging = first?.paging ?? {};
  const pageSize = Number(paging.page_size ?? (items.length || 50));
  const rawTotal = Number(paging.total_count ?? 0);
  // 官方偶发把 total_count 返回成全站总数；单个分类超过 500 视为异常，只信首屏
  const total = Number.isFinite(rawTotal) && rawTotal > 0 && rawTotal <= 500 ? rawTotal : firstItems.length;
  console.error(`[build-landmarks] 首屏 ${firstItems.length} 条 / page_size=${pageSize} / total_count=${rawTotal}`);
  let page = 1;
  let lastCount = firstItems.length;
  while (lastCount > 0 && lastCount >= pageSize && items.length < total && page < 10) {
    page += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = await request(apiKey, "/contents/list", {
      method: "POST",
      body: { ...body, page_no: page },
      throwOnError: true,
    });
    const nextItems = Array.isArray(next?.data)
      ? next.data
      : Array.isArray(next?.data?.items)
        ? next.data.items
        : [];
    if (!nextItems.length) break;
    items.push(...nextItems);
    lastCount = nextItems.length;
  }
  // 稳妥去重：万一接口分页异常重复返回，按 cid 去重，避免无效 ID 进入详情请求
  return [...new Map(items.filter((x) => x && x.cid).map((x) => [x.cid, x])).values()];
}

async function fetchDetail(apiKey, cid, lang) {
  await new Promise((resolve) => setTimeout(resolve, REQUEST_GAP_MS));
  const json = await request(apiKey, "/contents/info", {
    method: "POST",
    body: { cid, lang_code_id: lang },
    throwOnError: true,
  });
  return json?.data ?? null;
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function parseDistrict(address) {
  const normalized = text(address).replace(/^(首尔特别市|首尔市|首尔|서울특별시|서울시)\s*/, "");
  const m = normalized.match(/[\u4e00-\u9fa5]{1,6}区/);
  return m ? m[0] : "首尔";
}

function buildOpeningHours(extra) {
  if (!extra) return "";
  const clean = (v) => text(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const days = clean(extra.business_days);
  const time = clean(extra.cmmn_use_time);
  const closed = clean(extra.closed_days);
  const parts = days && time && days === time ? [days] : [days, time].filter(Boolean);
  let result = parts.join(" ") || "开放时间以官网为准";
  if (closed && !/全年不休|全年无休|常年开放|年中无休|연중무휴/.test(closed)) {
    result += `（休馆：${closed}）`;
  }
  return result.replace(/\s+/g, " ").trim();
}

function parseKoCid(multiLangList) {
  const entry = text(multiLangList)
    .split(",")
    .map((x) => x.trim())
    .find((x) => x.startsWith("ko:"));
  return entry ? entry.slice(3) : "";
}

function makePlace(zh, ko) {
  const cid = text(zh.cid);
  if (!cid) return { error: `缺少 cid（zh 详情为空）` };
  const traffic = zh.traffic ?? {};
  const extra = zh.extra ?? {};
  const lat = Number(traffic.map_position_y);
  const lng = Number(traffic.map_position_x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: `${cid} 坐标无效 (${traffic.map_position_y}, ${traffic.map_position_x})` };
  }
  const address = text(traffic.new_adres) || text(traffic.adres) || "";
  const summary = text(zh.sumry);
  const descText = stripHtml(text(zh.post_desc));
  const description = summary || (descText ? descText.slice(0, 400) : "");
  const tags = Array.from(
    new Set([
      "首尔观光",
      (text(zh.cate_depth) || "").replace(/^>\s*/, "").trim(),
      ...asArray(zh.tag).map((t) => text(t)).filter(Boolean),
    ])
  ).filter(Boolean);

  return {
    id: `vs-${cid}`,
    source: "visitseoul",
    sourceId: cid,
    name: text(zh.post_sj),
    nameLocal: ko ? text(ko.post_sj) : "",
    type: "sightseeing",
    category: "normal_sightseeing",
    officialCategory: (text(zh.cate_depth) || "").trim(),
    interestRelated: false,
    address,
    district: parseDistrict(address),
    latitude: lat,
    longitude: lng,
    openingHours: buildOpeningHours(extra),
    description,
    imageUrl: text(zh.main_img) || null,
    tags,
    evidence: [],
    confidence: null,
    officialUrl: text(extra.cmmn_hmpg_url) || null,
    feeInfo: text(extra.trrsrt_use_chrge_guidance) || text(extra.usage_fee) || "",
    subwayInfo: text(traffic.subway_info) || "",
    notice: text(extra.cmmn_important) || "",
    multiLangList: text(zh.multi_lang_list) || "",
    updatedAt: text(zh.updt_dt_text) || "",
  };
}

async function main() {
  const env = loadEnv();
  const apiKey = env.VISITSEOUL_API_KEY;
  if (!apiKey) {
    console.error("[build-landmarks] 缺少 VISITSEOUL_API_KEY（请检查 .env）");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : "";
  };
  const cidsArg = getFlag("--cids");
  const outArg = getFlag("--out");
  const outFile = outArg ? path.resolve(ROOT, outArg) : OUT_FILE;

  let listItems = [];
  let categoryLabel = "Custom selection";
  if (cidsArg) {
    listItems = cidsArg
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((cid) => ({ cid }));
    console.error(`[build-landmarks] 指定地点模式：${listItems.length} 条`);
  } else {
    console.error("[build-landmarks] 正在获取 Landmarks 分类 ID …");
    const category = await retry(() => findLandmarkCategory(apiKey));
    if (!category) {
      console.error("[build-landmarks] 未找到 Culture > Landmarks 分类，已中止");
      process.exit(1);
    }
    categoryLabel = `${category.com_ctgry_sn} ${category.ctgry_path}`.trim();
    console.error(`[build-landmarks] 分类：${categoryLabel}`);
    console.error(`[build-landmarks] 正在拉取 ${DISPLAY_LANG} 地点列表 …`);
    listItems = await retry(() => listAllContents(apiKey, category, DISPLAY_LANG));
    console.error(`[build-landmarks] 列表返回 ${listItems.length} 条`);
  }

  const allCids = [...new Set(listItems.map((x) => text(x.cid)).filter(Boolean))];
  const cids = allCids.filter((cid) => /^[A-Z]{2}[A-Za-z0-9]{7}$/.test(cid));
  if (cids.length !== allCids.length) {
    console.error(`[build-landmarks] 过滤异常内容 ID ${allCids.length - cids.length} 个`);
  }
  const places = [];
  const skipped = [];

  await mapConcurrent(cids, CONCURRENCY, async (cid) => {
    try {
      const zh = await retry(() => fetchDetail(apiKey, cid, DISPLAY_LANG));
      const koCid = parseKoCid(zh?.multi_lang_list);
      let ko = null;
      if (koCid) {
        try {
          ko = await retry(() => fetchDetail(apiKey, koCid, LOCAL_LANG));
        } catch (err) {
          console.error(`[build-landmarks] 韩文名获取失败 ${koCid}：${err.message}`);
        }
      }
      const place = makePlace(zh, ko);
      if (place?.error) {
        skipped.push(place.error);
      } else {
        places.push(place);
        if (places.length % 5 === 0) {
          console.error(`[build-landmarks] 进度：已成功 ${places.length}/${cids.length}`);
        }
      }
    } catch (err) {
      console.error(`[build-landmarks] 跳过 ${cid}：${err.message}`);
      skipped.push(`${cid}: ${err.message}`);
    }
  });

  places.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const payload = {
    demo: false,
    source: "visitseoul",
    category: cidsArg ? "Custom selection" : "Culture > Landmarks",
    lang: DISPLAY_LANG,
    fetchedAt: new Date().toISOString().slice(0, 10),
    note: cidsArg
      ? "VisitSeoul OpenAPI 官方真实数据（指定地点精选集合）。用于 P2 普通观光地点池；不含任何艺人粉丝证据，interestRelated 均为 false，evidence 为空。"
      : "VisitSeoul OpenAPI 官方真实数据（Culture > Landmarks 分类）。用于 P2 普通观光地点池；不含任何艺人粉丝证据，interestRelated 均为 false，evidence 为空。",
    places,
  };
  writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");
  console.error(`[build-landmarks] 成功 ${places.length} 条 / 跳过 ${skipped.length} 条`);
  for (const s of skipped) console.error(`[build-landmarks] 跳过：${s}`);
  console.error(`[build-landmarks] 已写入 ${outFile}`);
}

main().catch((err) => {
  console.error("[build-landmarks] 执行失败：", err);
  process.exit(1);
});
