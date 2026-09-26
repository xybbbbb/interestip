/**
 * visitseoul-fetch-en.mjs —— 用 VisitSeoul 官方接口抓「英文版」地点信息
 *
 * 为什么需要它：原型界面要支持中英切换，而英文地点名不能用"中文再翻英文"，
 * 必须用官方英文名（英文用户实际看到的写法，例如 Myeongdong / Gyeongbokgung）。
 * VisitSeoul 的接口本身支持多语言，中文条的 multiLangList 里直接给出了对应的英文 cid：
 *   ko:KOP000061, en:ENP000061, ja:JPP000061, zh-CN:CNP000061, ...
 *
 * 用法：node scripts/visitseoul-fetch-en.mjs
 * 产出：data/visitseoul-en.json（键 = 原型里的地点 id，如 vs-CNP000061）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PREVIEW = path.join(ROOT, "web-preview", "index.html");
const SELECTION = path.join(ROOT, "data", "visitseoul-selection.json");
const LANDMARKS = path.join(ROOT, "data", "visitseoul-landmarks.json");
const OUT = path.join(ROOT, "data", "visitseoul-en.json");

async function loadEnv() {
  const env = {};
  try {
    const raw = await fs.readFile(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {}
  return env;
}

async function readPlaces() {
  const html = await fs.readFile(PREVIEW, "utf8");
  const start = html.indexOf("const PLACES = [");
  const end = html.indexOf("\n];", start);
  return new Function(`return ${html.slice(start + "const PLACES = ".length, end + 3)};`)();
}

async function main() {
  const env = await loadEnv();
  const key = process.env.VISITSEOUL_API_KEY || env.VISITSEOUL_API_KEY;
  const base = (process.env.VISITSEOUL_BASE || env.VISITSEOUL_BASE || "https://api-call.visitseoul.net/api/v1").replace(/\/+$/, "");
  if (!key) throw new Error("缺少 VISITSEOUL_API_KEY（应放在 outputs/interest-mcp/.env）");

  const places = await readPlaces();
  const sightIds = places.filter((p) => p.pool === "sight").map((p) => p.id);

  // 从已有中文数据里拿到每个地点的多语言清单
  const sources = [];
  for (const file of [SELECTION, LANDMARKS]) {
    try {
      const j = JSON.parse(await fs.readFile(file, "utf8"));
      sources.push(...(Array.isArray(j) ? j : j.places ?? []));
    } catch {}
  }
  const byId = new Map();
  for (const p of sources) {
    const protoId = p.id?.startsWith("vs-") ? p.id : `vs-${p.sourceId}`;
    if (!byId.has(protoId)) byId.set(protoId, p);
  }

  const out = {};
  let ok = 0;
  let failed = 0;
  for (const id of sightIds) {
    const src = byId.get(id);
    const enCid = String(src?.multiLangList || "").match(/(?:^|,)\s*en:([^,]+)/)?.[1];
    if (!enCid) {
      failed += 1;
      console.log(`❌ ${id} 找不到英文 cid`);
      continue;
    }
    const call = async () =>
      (
        await fetch(`${base}/contents/info`, {
          method: "POST",
          headers: {
            "VISITSEOUL-API-KEY": key,
            Accept: "application/json;charset=UTF-8",
            "Content-Type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify({ cid: enCid, lang_code_id: "en" }),
        })
      ).json();
    // 接口偶发 500，重试两次
    let json = await call();
    for (let attempt = 0; attempt < 2 && !json?.data; attempt += 1) {
      await new Promise((r) => setTimeout(r, 1200));
      json = await call();
    }
    const d = json?.data ?? json?.result ?? json;
    const title = d?.post_sj ?? d?.title ?? d?.name;
    if (!title) {
      failed += 1;
      console.log(`❌ ${id}（${enCid}）返回异常：${JSON.stringify(json).slice(0, 160)}`);
      continue;
    }
    out[id] = {
      cid: enCid,
      name: title,
      address: d.traffic?.new_adres || d.traffic?.adres || null,
      openingHours: d.extra?.cmmn_use_time ? String(d.extra.cmmn_use_time).split(/\r?\n/)[0] : null,
      subwayInfo: d.extra?.cmmn_way || d.extra?.subway_info || null,
      summary: (d.sumry || "").trim().slice(0, 260),
    };
    ok += 1;
    console.log(`✅ ${id} → ${title}`);
  }

  await fs.writeFile(OUT, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n完成：成功 ${ok} 个，失败 ${failed} 个 → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
