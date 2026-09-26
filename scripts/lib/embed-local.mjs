/**
 * lib/embed-local.mjs —— 「端侧」embedding 客户端
 *
 * 端云协同里的「端」就是本机：由本机的模型服务（默认 Ollama）把文本变成向量。
 * 全量语料的向量只在本机计算和保存，不出本机；云端只拿到检索出来的 Top-K 证据。
 *
 * 支持三种本地服务（自动探测）：
 *   1. Ollama              POST {base}/api/embed        { model, input: [...] }   ← 推荐
 *   2. Ollama（旧接口）    POST {base}/api/embeddings   { model, prompt }
 *   3. OpenAI 兼容         POST {base}/v1/embeddings    { model, input: [...] }  ← LM Studio / vLLM / xinference
 *
 * 配置（写在仓库根目录的 .env，或直接用环境变量）：
 *   LOCAL_EMBED_BASE=http://127.0.0.1:11434
 *   LOCAL_EMBED_MODEL=bge-m3
 *   LOCAL_EMBED_PROVIDER=auto          # auto | ollama | openai
 */

import { loadEnvFile, ROOT } from "./llm.mjs";

export const DEFAULT_EMBED_BASE = "http://127.0.0.1:11434";
export const DEFAULT_EMBED_MODEL = "bge-m3";

export async function getEmbedConfig() {
  const env = await loadEnvFile();
  const base = (process.env.LOCAL_EMBED_BASE || env.LOCAL_EMBED_BASE || DEFAULT_EMBED_BASE).replace(/\/+$/, "");
  const model = (process.env.LOCAL_EMBED_MODEL || env.LOCAL_EMBED_MODEL || DEFAULT_EMBED_MODEL).trim();
  const provider = (process.env.LOCAL_EMBED_PROVIDER || env.LOCAL_EMBED_PROVIDER || "auto").trim();
  return { base, model, provider, root: ROOT };
}

async function postJson(url, body, { timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
    return { ok: res.ok, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** 探测本机可用的 embedding 接口。返回 {provider, ...} 或抛错（错误信息里带怎么修） */
export async function detectProvider(cfg) {
  if (cfg.provider === "ollama" || cfg.provider === "auto") {
    const r = await postJson(`${cfg.base}/api/embed`, { model: cfg.model, input: ["ping"] }, { timeoutMs: 20000 });
    if (r.ok && Array.isArray(r.json?.embeddings)) return { provider: "ollama", endpoint: "/api/embed", dim: r.json.embeddings[0]?.length ?? null };
    if (r.status !== 404 && r.status !== 0) {
      // 服务在，但模型可能没拉下来
      const msg = r.json?.error || r.text?.slice(0, 200) || "";
      if (/model/i.test(msg)) throw new Error(`本机服务在，但模型没找到：${msg}\n先跑：ollama pull ${cfg.model}`);
      if (!cfg.provider) throw new Error(`本机 embedding 服务返回 ${r.status}：${msg}`);
    }
  }
  if (cfg.provider === "ollama" || cfg.provider === "auto") {
    const r = await postJson(`${cfg.base}/api/embeddings`, { model: cfg.model, prompt: "ping" }, { timeoutMs: 20000 });
    if (r.ok && Array.isArray(r.json?.embedding)) return { provider: "ollama-legacy", endpoint: "/api/embeddings", dim: r.json.embedding.length };
  }
  if (cfg.provider === "openai" || cfg.provider === "auto") {
    const r = await postJson(`${cfg.base}/v1/embeddings`, { model: cfg.model, input: ["ping"] }, { timeoutMs: 20000 });
    if (r.ok && Array.isArray(r.json?.data?.[0]?.embedding)) return { provider: "openai", endpoint: "/v1/embeddings", dim: r.json.data[0].embedding.length };
  }
  throw new Error(
    `连不上本机 embedding 服务（${cfg.base}）。\n` +
      `  · 装 Ollama：https://ollama.com/download\n` +
      `  · 拉模型：  ollama pull ${cfg.model}\n` +
      `  · 确认在跑：ollama list\n` +
      `  · 或者改 .env 里的 LOCAL_EMBED_BASE / LOCAL_EMBED_MODEL`,
  );
}

/** 把一批文本变成向量（按 provider 自动选接口）。返回 {vectors, provider, dim} */
export async function embedTexts(texts, { cfg, provider, batchSize = 16 } = {}) {
  const conf = cfg ?? (await getEmbedConfig());
  const det = provider ?? (await detectProvider(conf));
  const out = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    if (det.provider === "ollama-legacy") {
      for (const t of batch) {
        const r = await postJson(`${conf.base}${det.endpoint}`, { model: conf.model, prompt: t });
        if (!r.ok || !Array.isArray(r.json?.embedding)) throw new Error(`embedding 失败（${r.status}）：${r.json?.error || r.text?.slice(0, 200)}`);
        out.push(r.json.embedding);
      }
    } else {
      const url = det.provider === "openai" ? `${conf.base}/v1/embeddings` : `${conf.base}${det.endpoint}`;
      const r = await postJson(url, { model: conf.model, input: batch });
      if (!r.ok) throw new Error(`embedding 失败（${r.status}）：${r.json?.error || r.text?.slice(0, 200)}`);
      const vecs = det.provider === "openai" ? (r.json?.data ?? []).map((d) => d.embedding) : r.json?.embeddings;
      if (!Array.isArray(vecs) || vecs.length !== batch.length) {
        throw new Error(`embedding 返回条数不对：要 ${batch.length} 条，拿到 ${Array.isArray(vecs) ? vecs.length : "非法"}`);
      }
      out.push(...vecs);
    }
    if (texts.length > batchSize) process.stderr.write(`\r  端侧 embedding 进度 ${Math.min(i + batchSize, texts.length)}/${texts.length}`);
  }
  if (texts.length > batchSize) process.stderr.write("\n");
  return { vectors: out, provider: det, dim: out[0]?.length ?? 0 };
}

export function l2normalize(vec) {
  let s = 0;
  for (const x of vec) s += x * x;
  const n = Math.sqrt(s) || 1;
  return vec.map((x) => x / n);
}

/** 已归一化的向量：点积 = 余弦相似度 */
export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}
