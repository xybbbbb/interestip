/**
 * lib/rag-answer.mjs —— 回答组装层（RAG 的 Generation 环节，**无模型占位版**）
 *
 * 现在只做模板拼接：把检索到的 Top-K 拼成一段带 [来源n] 的回答。
 * 第 3 步接大模型时，输入不变（query + hits），把这个函数换掉即可，
 * 评估集和「引用正确率」的判定逻辑不用动 —— 这就是刻意留出的接缝。
 *
 * 产品规则：低/中置信度的证据不允许写成肯定句，只能表述为「有粉丝提到，行程紧可跳过」。
 */

const HEDGE_CONFIDENCE = new Set(["low", "medium"]);

export const REFUSAL_TEXT = "资料里没有能回答这个问题的内容。";

/** 从语料文本里挑一句「像理由」的话（跳过名字、类型、区、池别这些字段） */
function snippet(doc) {
  const parts = String(doc.text || "")
    .split("。")
    .map((s) => s.trim())
    .filter(Boolean);
  const skip = new Set([doc.name, doc.nameLocal, doc.typeCn, doc.district]);
  const rest = parts.filter(
    (p) => !skip.has(p) && !p.startsWith("粉丝关联地点") && !p.startsWith("首尔官方观光点"),
  );
  return (rest[0] || parts[0] || "").slice(0, 90);
}

/**
 * 把检索结果拼成带引用的回答。
 * 没有命中 → 直接拒答（宁可说不知道，也不要硬答）。
 */
export function composeAnswer(query, hits, { maxSources = 3, citationGate = 0 } = {}) {
  if (!hits?.length) {
    return { text: REFUSAL_TEXT, citations: [], refused: true };
  }

  // 引用门槛（第 5 轮加入）：只有分数达到「最高分 × citationGate」的检索结果才允许被引用。
  // gate=0 时等于引用所有 Top-K（旧行为）——分数垫底的弱相关项会把「引用正确率」拖下水。
  const topScore = hits[0]?.score ?? 0;
  const picked = hits
    .filter((h, i) => i === 0 || (h.score ?? 0) >= topScore * citationGate)
    .slice(0, maxSources);
  const citations = picked.map((h, i) => ({
    n: i + 1,
    id: h.doc.id,
    name: h.doc.name,
    confidence: h.doc.confidence ?? "plain",
    url: h.doc.sources?.[0]?.url ?? null,
    hedged: HEDGE_CONFIDENCE.has(h.doc.confidence ?? ""),
  }));

  const lines = picked.map((h, i) => {
    const d = h.doc;
    const hedge = HEDGE_CONFIDENCE.has(d.confidence ?? "")
      ? "（有粉丝提到，尚未人工核验，行程紧可跳过）"
      : "";
    return `- ${d.name}${d.district ? `（${d.district}）` : ""}${hedge}：${snippet(d)} [来源${i + 1}]`;
  });

  const sourceLines = citations.map(
    (c) => `[来源${c.n}] ${c.name} · 置信度 ${c.confidence} — ${c.url ?? "（无链接）"}`,
  );

  const text = [`问题：${query}`, "根据资料：", ...lines, "", "来源：", ...sourceLines].join("\n");
  return { text, citations, refused: false };
}
