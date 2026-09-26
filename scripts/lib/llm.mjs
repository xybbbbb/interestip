/**
 * lib/llm.mjs —— RAG 的「生成」环节：把检索到的证据交给大模型写成带引用的回答
 *
 * 与模板版（rag-answer.mjs）的分工：
 *   rag-answer.mjs  拼模板，不需要 Key，用来跑通流程和做基线
 *   llm.mjs         调模型，输出人话，但**硬规矩一样**：每条结论挂 [来源n]、证据不足必须拒答
 *
 * 接口是 OpenAI 兼容的（DeepSeek: https://api.deepseek.com/chat/completions）。
 * Key 只从本地 .env 读，永远不进前端页面。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
const ENV_PATH = path.join(ROOT, ".env");

/** 极简 .env 解析（只支持 KEY=value，忽略注释） */
export async function loadEnvFile(file = ENV_PATH) {
  const out = {};
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      out[m[1]] = m[2].trim();
    }
  } catch {
    /* 没有 .env 就当作没配 */
  }
  return out;
}

export async function getLLMConfig() {
  const env = await loadEnvFile();
  const key = (process.env.LLM_API_KEY || env.LLM_API_KEY || "").trim();
  const base = (process.env.LLM_BASE_URL || env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = (process.env.LLM_MODEL || env.LLM_MODEL || "deepseek-chat").trim();
  return { key, base, model, configured: Boolean(key) };
}

export const REFUSAL_TEXT = "资料里没有能回答这个问题的内容。";

/** 版本化的提示词：prompt iteration 就是改这里 */
export const PROMPTS = {
  v1: {
    name: "v1 · 基础约束",
    system: [
      "你是「兴趣驱动旅行助手」的推荐生成器。",
      "你只能使用【资料】里的内容，不允许使用自己的常识或记忆补充任何事实。",
      "规则：",
      "1) 每条结论后面必须标注来源编号，写成 [来源n]；没有来源支撑的话不要写。",
      "2) 资料不足以回答问题时，只回答：资料里没有能回答这个问题的内容。",
      "3) 置信度是 medium 或 low 的地点，必须写成「有粉丝提到（尚未核验）」，不能写成确定的事实。",
      "4) 不要编造营业时间、价格、地址——资料里没写就别提。",
      "5) 用中文回答，最多 3 句话。",
    ].join("\n"),
  },
  v2: {
    name: "v2 · 能答就答（治过度拒答）",
    system: [
      "你是「兴趣驱动旅行助手」的推荐生成器。你只能使用【资料】里的内容，不允许使用自己的常识或记忆补充事实。",
      "",
      "先判断资料和问题的关系（不要写出判断过程）：",
      "A. 资料里有与问题相关的地点 → 必须把它推荐出来，并说明资料里写了什么。哪怕资料没覆盖问题的每个细节（比如几点开门、怎么去），也要先回答能回答的部分。",
      "B. 资料与问题完全无关（只是碰巧出现了同一个词）→ 只输出：资料里没有能回答这个问题的内容。",
      "",
      "输出规则：",
      "1) 每条结论后面必须标注来源编号，写成 [来源n]；没有来源支撑的话不要写。",
      "2) 只有情况 B 才拒答，并且拒答时只说那一句话，不要给替代建议、不要补一句「资料里没有…」。",
      "3) 置信度是 medium 或 low 的地点，必须写成「有粉丝提到（尚未核验）」。",
      "4) 不要编造营业时间、价格、地址。",
      "5) 用中文，最多 3 句话。",
    ].join("\n"),
  },
};

/** 把检索结果整理成提示词里的【资料】段落 */
export function buildRagPrompt(query, hits) {
  const blocks = hits.map((h, i) => {
    const d = h.doc;
    const meta = [d.district, d.typeCn, `置信度 ${d.confidence ?? "plain"}`].filter(Boolean).join("·");
    const url = d.sources?.[0]?.url ?? "（无链接）";
    return `[来源${i + 1}] ${d.name}（${meta}）\n${String(d.text).slice(0, 320)}\n链接：${url}`;
  });
  const user = [`用户问题：${query}`, "", "资料（只能使用这些）：", blocks.join("\n\n")].join("\n");
  return { system: PROMPTS.v1.system, user };
}

/** 调用 OpenAI 兼容的 chat/completions */
export async function callChat({ system, user }, { base, model, key, temperature = 0, timeoutMs = 60000 } = {}) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content ?? "";
  return { content: content.trim(), usage: json.usage ?? null, raw: json };
}

/** 从模型输出里解析 [来源n] —— 用来做「引用正确率」和「有没有编造来源」的检查 */
export function parseCitations(answerText, hits) {
  const marks = [...String(answerText).matchAll(/\[来源\s*(\d+)\]/g)].map((m) => Number(m[1]));
  const unique = [...new Set(marks)];
  const citations = [];
  const invalid = [];
  for (const n of unique) {
    const hit = hits[n - 1];
    if (!hit) {
      invalid.push(n);
      continue;
    }
    citations.push({ n, id: hit.doc.id, name: hit.doc.name, confidence: hit.doc.confidence ?? "plain" });
  }
  return { citations, invalid, markCount: marks.length };
}

/**
 * 生成器工厂：返回一个 async (query, hits) => { text, citations, refused, invalid, usage }
 * —— 与 rag-answer.mjs 的 composeAnswer 同签名（多了 async），所以评估层可以无痛替换。
 */
export function makeLlmGenerator(config, { promptVersion = "v1" } = {}) {
  const prompt = PROMPTS[promptVersion] ?? PROMPTS.v1;
  let calls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  return {
    name: `llm:${config.model}:${promptVersion}`,
    stats: () => ({ calls, promptTokens, completionTokens }),
    generate: async (query, hits) => {
      // 检索为空 → 不调用模型，直接拒答（省一次调用，行为也完全确定）
      if (!hits?.length) {
        return { text: REFUSAL_TEXT, citations: [], invalid: [], refused: true, usage: null };
      }
      const { user } = buildRagPrompt(query, hits);
      const { content, usage } = await callChat({ system: prompt.system, user }, config);
      calls += 1;
      promptTokens += usage?.prompt_tokens ?? 0;
      completionTokens += usage?.completion_tokens ?? 0;
      const { citations, invalid } = parseCitations(content, hits);
      // 判「拒答」不能只看有没有那句套话：模型可能先给了推荐、再补一句"资料里没有 XX 信息"。
      // 只要它给出了带来源的结论，就算回答过（这正是第 1 次跑模型版踩到的坑）。
      const refused = citations.length === 0 && /资料里没有|没有能回答|无法回答/.test(content);
      return { text: content, citations, invalid, refused, usage };
    },
  };
}
