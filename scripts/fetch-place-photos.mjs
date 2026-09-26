/**
 * fetch-place-photos.mjs —— 自动从 Wikipedia / Wikimedia Commons 抓景点主图
 *
 * 为什么能自动化：
 *   Wikipedia 几乎每个地标条目都有一张主图，而且这张图存在 Commons 上，
 *   接口里直接带**作者和许可证**（CC0 / CC BY / CC BY-SA / 公有领域），
 *   正好是我们要写署名的东西 —— 相当于"全世界的 VisitSeoul"。
 *
 * 链路：搜索词 → Wikipedia 条目 → 条目主图 → Commons 询问授权 → 下载 1400px 缩略图
 *
 * 用法（需要能访问 wikipedia.org，国内要开代理）：
 *   node scripts/fetch-place-photos.mjs                       # 抓 data/photo-queries.json 里全部地点
 *   node scripts/fetch-place-photos.mjs --only nyc-met,nyc-moma
 *   node scripts/fetch-place-photos.mjs --heroes              # 连两张 hero 一起抓
 *   node scripts/fetch-place-photos.mjs --dry-run             # 只查不下载，看看会拿到什么
 *   node scripts/fetch-place-photos.mjs --force               # 已存在的也重抓
 *
 * 产出：
 *   <--out>/<id>.jpg          默认 D:\interestip-images\places\<id>.jpg
 *   <--out>\..\credits.json   署名（作者 + 许可证），并同步一份到 web-preview\assets\credits.json
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const QUERIES = path.join(ROOT, "data", "photo-queries.json");
const CREDITS_OUT = path.join(ROOT, "web-preview", "assets", "credits.json");

const UA = "InterestipPrototype/0.1 (student prototype; contact: local)";
const THUMB_W = 1400;
const SLEEP_MS = 2200; // 对公共 API 客气一点（Wikimedia 有速率限制，太密会 429）

const argv = process.argv.slice(2);
const val = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : dflt;
};
const OUT = path.resolve(val("--out", "D:\\interestip-images\\places"));
const ONLY = (val("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");
const WITH_HEROES = argv.includes("--heroes");
const LIMIT = Number(val("--limit", "0")) || 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/** 网络抖动（尤其是走代理时）很常见，统一重试 3 次 */
async function withRetry(fn, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries) {
        // 429 = 被限流，等久一点再试（服务端给了 Retry-After 就听它的）
        const wait = e && e.status === 429 ? (e.retryAfter ? e.retryAfter * 1000 : 8000) : 900 * i;
        console.log(`        （第 ${i} 次失败：${e.message.slice(0, 60)} —— 等 ${Math.round(wait / 1000)}s 重试）`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

function getJson(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 4) return reject(new Error("重定向太多"));
    const req = https.get(url, { headers: { "user-agent": UA, accept: "application/json" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).toString(), depth + 1));
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}：${body.slice(0, 140)}`);
          err.status = res.statusCode;
          const ra = Number(res.headers["retry-after"]);
          if (Number.isFinite(ra) && ra > 0) err.retryAfter = ra;
          return reject(err);
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("返回的不是 JSON：" + body.slice(0, 140)));
        }
      });
    });
    req.on("error", (e) => reject(new Error(e.message)));
    req.setTimeout(30000, () => { req.destroy(); reject(new Error("超时（可能需要开代理）")); });
  });
}

function download(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 4) return reject(new Error("重定向太多"));
    const req = https.get(url, { headers: { "user-agent": UA } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error("HTTP " + res.statusCode));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        resolve(buf.length);
      });
    });
    req.on("error", (e) => reject(new Error(e.message)));
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("下载超时")); });
  });
}

/**
 * 第一步：搜索条目，拿它的主图文件名。
 *
 * 取前 5 个搜索结果而不是只取第一个，并且**跳过 SVG** ——
 * 因为有些条目的主图是 logo（例如 MoMA PS1 的 `MoMA_PS1_logo.svg`），
 * 渲染出来是一张全透明的空白图，放进卡片就是一块白。
 */
async function findPageImage(query) {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=pageimages&piprop=name&origin=*`;
  const j = await getJson(url);
  const pages = j?.query?.pages;
  if (!pages) return null;
  const ordered = Object.values(pages).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  for (const page of ordered) {
    const f = page?.pageimage;
    if (f && !/\.svg$/i.test(f)) return { file: f, title: page.title };
  }
  return null;
}

/**
 * 第二步：问图片源要地址 + 作者 + 许可证。
 * 注意：主图不一定在 Commons —— 有些是 Wikipedia 的**本地文件**，所以 Commons 找不到时要回退到 en.wikipedia。
 */
async function imageInfo(fileName) {
  for (const host of ["commons.wikimedia.org", "en.wikipedia.org"]) {
    const url =
      `https://${host}/w/api.php?action=query&format=json&prop=imageinfo` +
      `&titles=File:${encodeURIComponent(fileName)}&iiprop=url|extmetadata&iiurlwidth=${THUMB_W}&origin=*`;
    let j;
    try {
      j = await getJson(url);
    } catch {
      continue;
    }
    const page = Object.values(j?.query?.pages || {})[0];
    const info = page?.imageinfo?.[0];
    if (!info?.url) continue;
    const m = info.extmetadata || {};
    const rawArtist = stripHtml(m.Artist?.value || m.Credit?.value || "");
    // Commons 的 Artist 字段有时会把整段许可说明塞进来，太长就砍掉
    const artist = rawArtist.length > 90 ? rawArtist.slice(0, 90).trim() + "…" : rawArtist;
    const license = stripHtml(m.LicenseShortName?.value || m.UsageTerms?.value || "");
    return { url: info.thumburl || info.url, artist, license, host };
  }
  return null;
}

function creditLine(artist, license, pageTitle) {
  const parts = [];
  if (artist) parts.push(artist);
  if (license) parts.push(license);
  if (pageTitle) parts.push("via Wikipedia");
  return parts.length ? "Photo: " + parts.join(" / ") : "";
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(QUERIES, "utf8"));
  let list = [...(cfg.places || [])];
  if (WITH_HEROES) list = [...list, ...(cfg.heroes || [])];
  if (ONLY.length) list = list.filter((x) => ONLY.includes(x.id));
  if (LIMIT) list = list.slice(0, LIMIT);

  if (!list.length) {
    console.log("没有要抓的条目。检查 data/photo-queries.json 或 --only 参数。");
    return 1;
  }

  const isHero = (id) => id.startsWith("hero-");
  const outDir = OUT;
  const heroDir = path.dirname(outDir); // hero 放在 places 的上一级

  console.log(`要抓 ${list.length} 个条目`);
  console.log(`地点图 -> ${outDir}`);
  if (WITH_HEROES) console.log(`hero 图 -> ${heroDir}`);
  console.log(DRY ? "（dry-run：只查不下载）\n" : "");

  const credits = {};
  let ok = 0, skip = 0, fail = 0;

  for (const [i, item] of list.entries()) {
    const dir = isHero(item.id) ? heroDir : outDir;
    const dest = path.join(dir, item.id + ".jpg");
    const tag = `[${i + 1}/${list.length}] ${item.id}`;

    if (!FORCE && fs.existsSync(dest) && !DRY) {
      skip++;
      console.log(`${tag}  已存在，跳过`);
      continue;
    }

    try {
      const page = await withRetry(() => findPageImage(item.query));
      if (!page) {
        fail++;
        console.log(`${tag}  [!!] Wikipedia 上没找到带图的条目（搜索词：${item.query}）`);
        await sleep(SLEEP_MS);
        continue;
      }
      await sleep(SLEEP_MS);
      const info = await withRetry(() => imageInfo(page.file));
      if (!info?.url) {
        fail++;
        console.log(`${tag}  [!!] Commons 上没拿到图片地址：${page.file}`);
        await sleep(SLEEP_MS);
        continue;
      }
      const credit = creditLine(info.artist, info.license, page.title);
      if (DRY) {
        console.log(`${tag}  [--] ${page.title}  →  ${info.url.split("/").pop()?.slice(0, 60)}`);
        console.log(`        ${credit || "(无署名信息)"}`);
      } else {
        const bytes = await withRetry(() => download(info.url, dest));
        ok++;
        console.log(`${tag}  [OK] ${page.title}  ${(bytes / 1024).toFixed(0)} KB`);
        console.log(`        ${credit || "(无署名信息)"}`);
      }
      if (credit) credits[item.id] = credit;
    } catch (e) {
      fail++;
      console.log(`${tag}  [!!] ${e.message}`);
    }
    await sleep(SLEEP_MS);
  }

  if (!DRY && Object.keys(credits).length) {
    const inboxCredits = path.join(path.dirname(outDir), "credits.json");
    fs.mkdirSync(path.dirname(inboxCredits), { recursive: true });
    fs.writeFileSync(inboxCredits, JSON.stringify(credits, null, 2), "utf8");
    fs.mkdirSync(path.dirname(CREDITS_OUT), { recursive: true });
    // 保留已有的署名，和这次抓到的合并
    let merged = { ...credits };
    if (fs.existsSync(CREDITS_OUT)) {
      try {
        merged = { ...JSON.parse(fs.readFileSync(CREDITS_OUT, "utf8")), ...credits };
      } catch { /* 旧的坏了就以这次为准 */ }
    }
    fs.writeFileSync(CREDITS_OUT, JSON.stringify(merged, null, 2), "utf8");
    console.log(`\n署名写入：${CREDITS_OUT}（${Object.keys(merged).length} 条）`);
  }

  console.log(`\n完成：成功 ${ok} · 跳过 ${skip} · 失败 ${fail}`);
  if (fail) console.log("失败的条目：换一句搜索词再试（改 data/photo-queries.json），或者手动找一张。");
  if (!DRY) {
    console.log("\n接下来：");
    console.log("  python scripts/prepare-images.py      # 压成成品");
    console.log("  node scripts/apply-local-images.mjs   # 接进页面");
  }
  return fail && !ok ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("\n出错了：" + e.message);
  console.error("如果是 ECONNRESET / 超时 —— 说明连不上 Wikipedia，需要开代理再跑。");
  process.exit(1);
});
