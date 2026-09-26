# AI Agent Use Case & Evaluation

**Case study: Interestip — an Interest-Driven Travel Assistant**
From one sentence ("I'm going to a CORTIS concert and want to see the places they've been to") to an itinerary you can actually walk.
This document covers the use case, the evaluation design (18 test cases), and five rounds of iteration on the retrieval pipeline.

> 中文版：[`agent-use-case-evaluation.md`](agent-use-case-evaluation.md) · Live prototype: https://xybbbbb.github.io/interest_trip/ (EN / 中文)

---

## 0. TL;DR

| | |
|---|---|
| **Use case** | A fan states her motivation in one sentence → the agent retrieves evidence for interest-related places → produces a feasible day-by-day itinerary |
| **Agent behaviours under test** | ① retrieve on demand ② cite a source for every claim ③ **refuse when the evidence is insufficient** ④ never state low-confidence evidence as fact |
| **Evaluation set** | **18 cases**: A) 12 retrieval & answer cases (including 3 "the corpus has no answer" negatives) · B) 3 boundary probes · C) 3 itinerary workflow assertions |
| **Iterations** | 5 rounds on retrieval + 2 rounds on the generation prompt — **2 of the 5 retrieval changes were rejected by the evaluation set** |
| **Final results** | Retrieval hit rate **100%** · citation precision **100%** · refusal accuracy **100%** · 17 of 18 cases passing |
| **The one failure** | "想找个地方吃东西 / I want to find something to eat" — a paraphrase with no lexical overlap. A known boundary of keyword search, kept as the baseline for the next round |

---

## 1. The use case

**User**: someone flying to Seoul for a CORTIS concert — not a generic tourist, a fan.

**What she needs** is not a travel guide. It is three things:

1. Which places are worth it, and **why** — with a source, not "everyone says so"
2. Whether those places **fit into her days** — travel time that actually works
3. That concert day stays clear (she has to be at the venue by 19:00)

**Why the usual approach fails**: fan places (music-video spots, members' restaurants, pop-ups) live in scattered community posts with wildly different reliability, and they are geographically all over the city. Copying a list usually means three districts in one day and four hours of transit.

---

## 2. How the agent is designed

```
One sentence from the user
   │
   ├─ 1. Evidence corpus   25 places, each with: source link, source type, date, confidence, human-review status
   │
   ├─ 2. Retrieval         BM25 keyword search (Chinese text tokenised into bigrams)
   │                       → Top-K with two gates ("if nothing is relevant, return nothing")
   │
   ├─ 3. Generation        Top-K → LLM → an answer where every claim carries [source n];
   │                       medium/low-confidence evidence must be hedged ("a fan reported…");
   │                       empty retrieval → refuse ("the material doesn't cover this")
   │
   └─ 4. Scheduling        deterministic: geographic clustering by day → nearest-neighbour + 2-opt
                           → hard constraints (concert locked at 19:00, nothing after 18:30,
                             overflow goes to a "not scheduled yet" list rather than being dropped)
                           → travel times from real public-transit routing (102 OD pairs)
```

**Why this counts as an agent and not just a program**: between steps 3 and 4 there is a self-assessment — *"is the evidence I have good enough to make a recommendation? If not, say I don't know."* That is exactly where agents fail most often (retrieving badly and answering anyway), and it is what this evaluation is built around.

---

## 3. Evaluation design: 18 test cases

### Why these three groups

| Group | Count | What it tests | Why it must exist |
|---|---|---|---|
| **A** — retrieval & answer | 12 (9 answerable + 3 negatives) | Can it find the right evidence, and does it refuse when it can't? | The negatives are the point: **a question the corpus cannot answer must get "I don't know"** |
| **B** — boundary probes | 3 | colloquial paraphrase, scoped search, proper nouns | Real users don't ask in corpus language |
| **C** — itinerary workflow | 3 | 19:00 lock · nothing after 18:30 · nothing dropped | A perfect recommendation is worthless if the itinerary can't be walked |

### Group A — retrieval & answer (12)

| # | Question | Expected | Retrieved | Result |
|---|---|---|---|---|
| q01 | Where do I buy the bracelet the members wear? | Bongeunsa Temple | Bongeunsa Temple, Torriden pop-up | ✅ |
| q02 | Which restaurant did a member go to for their birthday? | Jikhwajangin (Yongsan) | Jikhwajangin (Yongsan) | ✅ |
| q03 | How do I visit the music-video filming spots? | Sinsa / Hannam Station | Sinsa, Hannam, Children's Grand Park | ✅ |
| q04 | The shop where you can order the "CORTIS" smoothie | Oakberry | Oakberry | ✅ |
| q05 | Where was the two-day variety show filmed? | Seoul Children's Grand Park | Seoul Children's Grand Park | ✅ |
| q06 | Where can I see the Han River at night with fountains? | Banpo fountain / Yeouido Hangang Park | Banpo fountain, Yeouido Hangang Park | ✅ |
| q07 | Where should I go shopping for beauty products? | Myeongdong / Dongdaemun | Myeongdong | ✅ |
| q08 | How do I plan a Michelin three-star marriage proposal by helicopter? | **refuse** | refused | ✅ |
| q09 | Is it easy to rent a car in Jeju? | **refuse** | refused | ✅ |
| q10 | How do I take the train from Seoul to Busan? | **refuse** | refused | ✅ |
| q11 | Is the barbecue place in Gimpo worth a special trip? | Euljiro Seoktan-gui (Gochon) | same | ✅ |
| q12 | I want somewhere to walk, take photos and see night views | any of 4 parks/towers | Seokchon Lake at night | ✅ |

### Group B — boundary probes (3)

| # | Question | Expected | Retrieved | Result |
|---|---|---|---|---|
| p01 | 想找个地方吃东西 (I want to find something to eat) | a restaurant/market | **refused** | ❌ known limitation |
| p02 | 同款餐厅 (same-as-artist restaurant), fan places only | Jikhwajangin etc. | Jikhwajangin (Yongsan) | ✅ |
| p03 | 乙支路煤炭烧烤在哪 (where is Euljiro coal barbecue) | Gimpo branch | same | ✅ |

### Group C — itinerary workflow assertions (3, must hold in all three trip scenarios)

| # | Assertion | Result |
|---|---|---|
| W1 | The concert is locked at 19:00 on the show day | ✅ 3/3 scenarios |
| W2 | Nothing is scheduled after 18:30 on the show day (re-checked with **real** travel times) | ✅ 3/3 scenarios |
| W3 | Anything that doesn't fit goes to a "not scheduled yet" list — no place is dropped (25/25 accounted for) | ✅ 3/3 scenarios |

### The four metrics

| Metric | Definition | Why this one |
|---|---|---|
| **Retrieval hit rate** | share of answerable questions where an expected source appears in the Top-5 | if retrieval fails, everything downstream fails |
| **Citation precision** | of the `[source n]` markers in an answer, how many point to an expected source | this is "did the answer cite the wrong thing" |
| **Refusal accuracy** | negatives correctly refused **+** answerable questions not wrongly refused | **the failure mode that matters most for an agent: answering when it doesn't know** |
| **Case pass rate** | each case is pass/fail; the ratio is the single number to communicate | easy to report, hard to game |

---

## 4. Five rounds of retrieval iteration (one change per round)

| Round | Problem found | Change | Hit rate | Citation precision | Refusal accuracy | Case pass rate | Kept? |
|---|---|---|---|---|---|---|---|
| **R1** | starting point: BM25, Chinese tokenised into single characters + bigrams, no threshold | — | 100% | 73% | 75% | 80% | — |
| **R2** | single characters ("星/求/手") matched far too much | bigrams only + relevance threshold `max(1.5, top × 0.35)` | 100% | 79% | 92% | 87% | ✅ |
| **R3** | the hard negative "Michelin three-star proposal by helicopter" was answered on the strength of one word ("餐厅") | `minimum_should_match`: with more than 2 query terms, a doc must match **≥ 2 distinct terms** | 100% | **85%** | **100%** | **93%** | ✅ |
| **R4** | colloquial paraphrase "想找个地方吃东西" returned nothing | a small synonym table (eat → restaurant / market / street food) | 100% | 65% ↓ | 92% ↓ | 87% ↓ | ❌ **rejected by the evaluation set, reverted** |
| **R5** | R4's expansion pulled in weakly-related documents | revert R4; instead only cite sources scoring ≥ 50% of the top hit | 100% | 83% ↓ | 100% | 93% | ❌ **no net gain, not adopted** |

### The two rejected rounds are the most valuable part of this document

- **R4**: synonym expansion sounds obviously right, and it did fix the paraphrase — but it **also resurrected the hard negative**. The assistant started giving suggestions for questions its corpus could not answer. For a travel assistant, **inventing a recommendation is far worse than saying "I don't have that"**. Refusal accuracy fell from 100% to 92%, so it was reverted.
- **R5**: the lesson from R4 was "recall bought at the cost of precision", so the next attempt tightened *citations* instead. Citation precision went 85% → 83%: the gate pushed out a **correct** source. Recorded as "didn't help", not adopted.

> Without a pre-built evaluation set, both rounds would have shipped as "improvements".

---

## 5. Results with the template generator

- **17 of 18 cases pass**: A 12/12 · B 2/3 · C 3/3
- Retrieval hit rate **100%** · citation precision **85%** · refusal accuracy **100%**
- Citation structure self-check: every `[source n]` in an answer comes from the actual retrieval results — **no invented sources**

**Known limitations (recorded, not hidden)**

1. **Paraphrase**: "想找个地方吃东西" still retrieves nothing. A keyword-search boundary that a synonym table cannot fix cleanly — which is the concrete, evidence-based case for adding embeddings later
2. **Ranking noise**: the citation-precision loss comes from weakly-related documents still entering the Top-K (e.g. a pop-up store surfacing for a bracelet question); a reranker would be the fix
3. **Sample size**: 18 cases catch order-of-magnitude problems, not fine-grained differences — the next step is to expand to 30+

---

## 6. Adding an LLM: prompt iteration (RAG step 3)

The generation layer was switched from a template to a real model (DeepSeek `deepseek-chat`, OpenAI-compatible), leaving the retrieval layer untouched so the metric change can be attributed cleanly.

| Generation | Retrieval hit rate | Citation precision | Refusal accuracy | Case pass rate (A+B) |
|---|---|---|---|---|
| Template (baseline) | 100% | 85% | 100% | 14/15 |
| Model · prompt v1 | 100% | **100%** | 83% ↓ | 12/15 |
| Model · prompt v2 | 100% | **100%** | **100%** | 14/15 |

### Round 1 (v1) surfaced two problems — one in the prompt, one in my own measurement

1. **The model over-refused**: "How do I visit the music-video filming spots?" retrieved three relevant documents, and the model still answered "the material doesn't cover this". It was judging against *"does the material cover every detail of the question?"* — the user asked *how to visit*, the corpus only said *this is where the video was filmed*.
2. **My evaluator was wrong**: for "Is the barbecue place in Gimpo worth a special trip?" the model answered well (citing "outside Seoul, plan a separate round trip") and then added "the material doesn't say whether it's worth the trip" — and my keyword-based check counted that as a refusal. **That was a bug in the measuring instrument, not in the model.** Fixed so that a refusal only counts when the answer contains no cited claim at all.

### Round 2 (v2): change the criterion from "is the material complete?" to "is the material relevant?"

> A. If the material contains a place related to the question → answer, and explain what the material says, even if it doesn't cover every detail
> B. Only if the material is unrelated (a word merely collides) → refuse

Result: citation precision stays at 100%, refusal accuracy returns to 100%, pass rate 12/15 → 14/15.

### What this means

- **Handing generation to a model lifted citation precision from 85% to 100%**: the template cited every retrieved document, including weak ones; the model cites only what actually supports the claim
- It also introduced a **new failure mode: over-caution** — a model refuses more readily than a template. That is exactly what an evaluation set can measure (83% → 100% after the prompt change), and it cannot be fixed by intuition
- Cost of a full evaluation run: 11 calls, ~5.3k input + 0.6k output tokens — well under one cent at DeepSeek pricing
- **Not yet in the product**: the model runs at build time / on the command line. A static page cannot hold an API key, so putting it in the live product means either pre-generating the recommendation text or adding a minimal backend

---

## 7. What I'd do next

1. **Move generation into the product** — pre-generate the recommendation text at build time (no backend, keeps the single-file deployment), or add a minimal backend (T4) so the page can call the model live
2. **Add embeddings** — the BM25 vs. vector comparison, with the paraphrase case above as the acceptance test
3. **Expand the evaluation set to 30+** cases, including conflicting evidence and multi-turn follow-ups
4. **Test with real users** (5–10 people, same task) — the one thing this project cannot claim yet

---

## 8. How to reproduce

```bash
cd outputs/interest-mcp
node scripts/agent-case-check.mjs          # 18 cases → data/agent-case-report.json
node scripts/rag-iterations.mjs            # the 5-round comparison → data/rag-iterations.json
node scripts/rag-eval.mjs                  # detailed report for the current configuration
node scripts/rag-eval.mjs --show-answers   # additionally print each answer with its citations

# with an LLM (needs LLM_API_KEY in .env; any OpenAI-compatible endpoint)
node scripts/rag-generate.mjs "想买 CORTIS 同款的手串"
node scripts/rag-eval.mjs --generator llm --prompt v2
node scripts/benchmark-travel-model.mjs    # the travel-time model: real routing vs. straight-line estimates
```

Data and code: `data/rag-eval-set.json` · `data/agent-case-report.json` · `data/rag-iterations.json` ·
`scripts/lib/rag.mjs` (retrieval + the two gates) · `scripts/lib/llm.mjs` (prompt versions + call) · `scripts/lib/rag-eval-core.mjs`
