# Interestip

> An interest-driven travel assistant.


> **Turn what you love into where you go.**

An AI-powered travel assistant that doesn't just help you visit a city — it helps you turn the places connected to **what you love** (an artist, a show, an interest) into a real, feasible trip.

The project started with a very personal question:

> “If I'm traveling to Seoul for a CORTIS concert, why can't my itinerary also include the places they've been, the cafés they've visited, and the spots where their music videos were filmed?”

The first vertical is **fandom travel**: CORTIS × Seoul. A second vertical — **New York · Art & Culture** — then swaps the city, the interest *and* the data source on purpose, to check whether the framework really generalises or only worked once. Beyond that, the same framework could apply to film locations, café trails, food journeys, sports trips, hiking routes, and more.

---

## 1. Positioning: Not “Another Generic AI Travel Planner”

Generic AI travel planners are getting better every day, and competing with them on breadth is pointless.

This project focuses on a narrower question:

> **When someone travels because of an interest, can an assistant discover, verify, and organize the places tied to that interest — and turn them into a realistic itinerary?**

In other words:

```text
Typical:    Destination → Places → Itinerary
Ours:       Interest → Associated Places → Destination → Constraints & Preferences → Personalized Journey
```

Fandom travel is just the first vertical; New York · Art & Culture is the second. The point of a second one is to test the framework when the city, the interest and the data source all change.

---

## 2. First Use Case: CORTIS × Seoul

A CORTIS fan traveling to Seoul might care about:

- The concert venue (already confirmed — highest priority)
- Restaurants and cafés the members have visited
- Music video filming locations
- Popular fan hangouts and photo spots
- Recreating “same-pose” photos
- Ordinary Seoul sightseeing that fits along the way

The guiding principle:

> **Fandom should light up a trip, not hijack it.**

A good itinerary mixes fandom-related experiences with normal sightseeing, food, rest, and personal preferences — not a pilgrimage that leaves no room to simply enjoy Seoul.

### Current Prototype Flow

```text
User names an interest and a destination (e.g. CORTIS + Seoul)
  → Known combinations open the matching Interest Hub; unknown ones open an honest
    "this hub is still growing" state that invents nothing and offers the contribution loop
  → System shows priorities: P0 concert → P1 related places → P2 sightseeing
  → User marks fan places “must-go / nice-to-have” and multi-selects sights (continuous selection)
  → Answers days, concert date, pace, budget, arrival/departure, lodging strategy
  → Generates a map-based itinerary: full-trip overview by default, per-day view toggle
  → Concert day automatically leaves time free after 7 PM
  → Recommends the best place to stay per day (adjustable day by day)
  → Low-confidence places can be hidden with one click and show a ⚠ warning in the plan
  → Basic manual adjustments: drag an item to another day
  → On-site mode: a big local-language place card plus essential phrases for a driver or shop staff
  → Contributions close the loop: submit a place → pending verification → approved →
    it enters the circle's pool with its evidence and can be scheduled into someone else's trip
  → The same engine and the same flow then run a second vertical:
    New York · Art & Culture (different city, different interest, different data source)
```

**Live prototype:** <https://interestip.xianyubing6.workers.dev>

> ⚠️ **Where the data actually stands.** Every travel time on the page comes from a real public-transit query (Transitous / MOTIS); pairs the router could not cover are marked as estimates. The **New York** vertical uses real OpenStreetMap places with a map source link on every card, real hotel names and coordinates (no prices), and marks opening hours it could not verify from a primary source as "check the official site". The **CORTIS × Seoul** vertical mixes curated fan places (each with its source and a confidence level) with official VisitSeoul sightseeing data; some fan coordinates are area/station level and still pending manual verification, and its hotels remain sample data.

---

## 3. Trust & Evidence Layer (Core Innovation)

Claims like “this artist visited this restaurant” vary wildly in reliability. The source could be:

- Official content / official social accounts (most reliable)
- Press interviews and media reports
- Multiple independent fan reports that corroborate each other
- A single community post
- An unverified rumor

That's why evidence is a first-class data structure in this project — not a suggestion the AI makes up on the spot:

```text
Place
│
├── Interest / Entity
├── Source
├── Evidence
├── Date
└── Confidence
```

Confidence levels:

- 🟢 High — official or first-hand evidence
- 🟡 Medium — multiple independent secondary sources
- 🔴 Low — a single unverified community claim

The system is transparent when information can't be independently verified: low-confidence places are downgraded or clearly flagged, and users can hide them with one click.

### Data Acquisition Strategy (Important Boundaries)

Social platforms generally block scraping and prohibit unauthorized automation, so this project does **not** rely on aggressive crawlers. Place data comes from three complementary paths:

1. **Official sightseeing data**: ordinary Seoul attractions come from the VisitSeoul OpenAPI (application pending); maps and geocoding use free/open sources such as OpenStreetMap.
2. **Semi-automated fan-data collection + human review**: candidate leads are collected from official content, public fan compilations, media, and user submissions. AI organizes and cross-checks; humans make the final call. The result is a place database with traceable evidence.
3. **Image recognition as a verification tool, not an oracle**: in the future, visual comparison will help verify whether a fan-identified place actually matches footage. AI proposes candidates; it never delivers the verdict alone.

Each new interest domain has a one-time database-building cost. This is a **reusable data asset and a moat**, not throwaway work — places overlap heavily across artists and verticals, so the database compounds over time.

---

## 4. The Role of AI

The project deliberately does **not** use an LLM for everything:

### AI / LLM

- **On the edge (local AI PC, Ollama + BGE-M3):** embedding the corpus, embedding the query,
  cosine Top-K retrieval, RRF fusion with BM25, and the "is there any evidence at all?" decision.
  The whole corpus stays on the machine and this half costs no tokens — see §5.1.
- **In the cloud (DeepSeek):** turning the retrieved Top-K evidence into prose with `[source n]`
  citations, and refusing when the evidence does not support an answer.
- Natural-language preference understanding and information extraction
- Recommendation reasoning and itinerary explanations
- Conversational itinerary adaptation

### Structured Data

- Places, coordinates, opening hours, events
- Evidence and source metadata
- User preferences

### Deterministic Systems (built — this is what actually schedules the trip)

- Geographic clustering by day, so places close together land on the same day
- Nearest-neighbour ordering + 2-opt optimisation within each day
- Real travel times from a pre-generated transit matrix (102 Seoul pairs / 105 New York pairs, queried from Transitous/MOTIS); uncovered pairs fall back to an estimate and say so on the page
- A **booked anchor** as a hard constraint — the concert starts at 19:00, so the day has to wind down before it; a timed museum entry at 10:30 makes the day start from that point instead
- Opening hours, a daily pace cap, arrival/departure windows, and an overflow list for what didn't fit
- Lodging scoring per day: total travel time, number of subway lines, and taxi distance when switching hotels

Core design principle:

> **Use AI where language understanding and reasoning add value; use deterministic systems where correctness must be deterministic.**

---

## 5. Current Technical Progress (Sep 2026)

### References

- Academic references: AgentTravel, TravelPlanner (studied for planning algorithms and deterministic constraints; not used as code bases).

### Done

- ✅ Standalone **interest-mcp** module (Node.js, zero third-party dependencies, MCP Streamable HTTP protocol): interest-place + evidence service. Protocol smoke tests: 7/7 passed.
- ✅ **Two live verticals in one self-contained prototype** (a single HTML file, no build step, no dependencies): CORTIS × Seoul and New York · Art & Culture, switchable from the home page.
- ✅ **Real transit times**: 102 Seoul + 105 New York place-to-place pairs queried from Transitous (MOTIS), 0 failures; every leg on the page is labelled real route / walk / estimate.
- ✅ **Deterministic scheduling engine**: clustering → nearest-neighbour → 2-opt → time assignment, with anchors, pace caps and opening hours.
- ✅ **Evidence layer**: each place carries a source link and a confidence level; low-confidence places can be hidden with one click.
- ✅ **Build-time LLM layer**: 25 places × 2 languages of recommendation text pre-generated with DeepSeek, with confidence handling and source attribution.
- ✅ **RAG pipeline**: 25-document corpus → BM25 behind two gates → LLM answers that must cite `[source n]` or refuse; 18-case evaluation set, 17/18 pass, citation accuracy 85% → 100% after prompt work.
- ✅ **VisitSeoul sightseeing data imported** (14 real places with official English names); field-mapping document and fetch scripts are in `docs/` and `scripts/`.
- ✅ **Interest circle**: the place pool is presented as a circle, with every number (places / with a source / high confidence / below high confidence / source mix) **computed live from the data** — nothing hard-coded.
- ✅ **Community submission loop** — the flywheel step that is hardest to copy: a user submits a place → it enters a **pending-verification queue** (never straight into the pool) → a reviewer approves or rejects it → only then does it become a `pool:"fan"` place, carrying its source, evidence chain and confidence into everyone else's itinerary.
- ✅ **New-interest explorer**: two inputs (Interest + Destination). Known combinations route straight into the matching hub; unknown ones open an honest "this hub is still growing" state that **invents no places** and hands the user to the submission loop instead.
- ✅ **Edge–cloud co-processing** (see §5.1): on-device vector retrieval (Ollama + BGE-M3, 1024-dim, corpus never leaves the machine) + cloud generation (DeepSeek), evaluated on the same 18-case set.
- ✅ **Genuinely zero external dependencies**: Leaflet 1.9.4 is inlined into the single HTML file (images as data URIs), so the prototype makes **no requests to any CDN** — built for a mainland-China demo where `unpkg.com` is unreliable.
- ✅ **Bilingual to the last detail**: place names, districts, opening hours, notes and the evidence UI all switch ZH/EN with no Chinese left in the English UI (asserted in the test suite).
- ✅ **Photo pipeline with automatic attribution**: landmark photos are fetched from Wikipedia / Wikimedia Commons (the API returns the author and licence), cropped, compressed ~14× and wired into the cards; CC BY / CC BY-SA credits are written to `web-preview/assets/credits.json` and shown under each image.
- ✅ Renamed to **Interestip** (new logo, favicon and subtitle), and the local project folder now matches the product name.

### Architecture

```text
┌───────────────────────────────────────────────┐
│  User-facing prototype / future main app        │
│  (standalone static prototype)                  │
│  AI chat · map · itinerary editing              │
└───────────────────┬────────────────────────────┘
                    │ MCP Streamable HTTP
┌───────────────────▼────────────────────────────┐
│  interest-mcp (Node.js, independent module)      │
│  interest places + evidence queries              │
└───────┬─────────────────────────────┬───────────┘
        │                             │
┌───────▼───────────┐     ┌───────────▼──────────┐
│  Fan place DB      │     │  VisitSeoul POI pool │
│  official/fan/media│     │  (key pending)       │
│  human review      │     │  official open data  │
│  + evidence        │     │                      │
└────────────────────┘     └──────────────────────┘
```

### 5.1 Edge–cloud co-processing (why the local PC does half the job)

The retrieval half runs **on the user's own machine**; only the generation half goes to the cloud.
Full corpus → local embeddings → local retrieval → Top-K evidence → cloud LLM. The corpus never
leaves the machine, and when the edge finds no evidence the cloud is **never called at all**.

| | Edge (local AI PC) | Cloud |
|---|---|---|
| Runs where | Ollama on `127.0.0.1:11434` | DeepSeek (OpenAI-compatible API) |
| Model | BGE-M3, 1024-dim embeddings | `deepseek-chat` |
| Responsibility | Embed corpus, embed query, cosine Top-K, RRF-fuse with BM25, decide *"is there evidence at all?"* | Turn the Top-K evidence into prose with `[source n]` citations |
| Why here | Corpus stays local; zero token cost; works offline; millisecond latency | Generation quality and scale |
| Data boundary | Whole corpus (25 docs) | Only the Top-K evidence (default 5) |

Measured on the same 18-case evaluation set (`node scripts/rag-eval-vector.mjs`):

| Mode | Retrieval hit | Top-1 | Citation precision | Refusal accuracy | Case pass |
|---|---|---|---|---|---|
| `bm25` keyword | 100% | 100% | 85% | **100%** | 93% |
| `vector` (edge) | 100% | 100% | 69% | 92% | 93% |
| `hybrid` (RRF) | 100% | 100% | 61% | 92% | 93% |

**What the edge actually buys us.** Keyword search has a structural blind spot: the evaluation set's
single failing case is the colloquial *"想找个地方吃东西"* ("just want to find somewhere to eat"),
which BM25 answers with **zero hits**. BGE-M3 retrieves the right place immediately — and recall
improves on three other queries too (2→4, 1→3 and 1→5 relevant documents).

**What it costs, stated honestly.** Naive vector retrieval **breaks the refusal behaviour**:
refusal accuracy fell 100% → 75%, because a dense model will always hand back *something* that
looks similar. The threshold was therefore calibrated against the evaluation set rather than guessed:

| `vectorMinScore` | Retrieval hit | Refusal accuracy | Case pass |
|---|---|---|---|
| 0.30 (first guess) | 100% | **75%** | 80% |
| **0.50 (adopted)** | **100%** | **92%** | **93%** |
| 0.55 | 89% ↓ | 83% | 87% |

**A known limit we did not paper over:** the hard negative *"how do I take the train from Seoul to
Busan?"* is still answered instead of refused at 0.50 — and pushing the threshold higher starts
costing recall. Pure thresholding has a ceiling here; the honest next step is topic/intent
filtering, not more tuning.

---

## 6. Roadmap

```text
✅ Concept: from generic AI travel planner to interest-driven travel
✅ Competitive analysis and differentiation
✅ First use case: CORTIS × Seoul
✅ Standalone implementation (no external app base)
✅ Interest place + evidence service prototype (MCP, 7/7 tests passed)
✅ Product UI prototype published
✅ VisitSeoul data imported (14 real places, official English names)
✅ Deterministic scheduling engine with real transit times (102 Seoul / 105 New York pairs)
✅ RAG pipeline with an 18-case evaluation set (17/18)
✅ Second vertical: New York · Art & Culture (OpenStreetMap + Transitous)
✅ Interest circle — all statistics computed live from the data
✅ Community submission loop — submit → pending verification → approved → place pool
✅ New-interest explorer — Interest + Destination, with an honest "not curated yet" state
✅ Edge–cloud co-processing — on-device BGE-M3 retrieval + cloud generation, threshold calibrated on the eval set
✅ Zero external dependencies (Leaflet inlined; the page requests no CDN)
✅ Rebranded to Interestip (logo, favicon, bilingual copy)
✅ Landmark photo pipeline with automatic CC attribution
⬜ Real-user validation — the biggest gap right now: 3–5 people running the same task
⬜ Replace the placeholder concert venue in the CORTIS vertical with the real one
⬜ Work through the verification queue (opening hours, fan coordinates, Korean place names)
⬜ Intent/topic filtering in front of vector retrieval (the remaining hard-negative case)
⬜ End-to-end smoke tests in CI (the workflow currently only deploys)
⬜ YouTube Data API search for official content (metadata layer)
⬜ Image-recognition-assisted verification (visual matching, evidence only)
⬜ Expand to more interest verticals
```

---

## 7. Project Status

**Phase:** Working MVP on real data → validation

**Concept:** Interest-Driven Travel Assistant

**Verticals live:** CORTIS × Seoul (fandom travel) · New York · Art & Culture

**Live prototype:** <https://interestip.xianyubing6.workers.dev>

**Edge–cloud:** on-device BGE-M3 vector retrieval + cloud (DeepSeek) generation; corpus stays local.

**Next steps:** run the first real-user test (3–5 people, the same task) → replace the placeholder concert venue → close the verification queue → add intent filtering ahead of vector retrieval

---

## 8. Project Philosophy

This is an independent product-building project, not a startup-first exercise. Priorities:

1. Solve a problem the creator genuinely cares about;
2. Practice end-to-end AI product development;
3. Build a repeatable product discovery and validation workflow;
4. Build and test a real MVP;
5. Document decisions, failures, pivots, and iterations;
6. Explore how a narrow vertical can reveal a broader framework.

The project values **learning and validation over premature commercialization**.

---

## 9. License & Acknowledgments

This project's own code is released under the **MIT License** — see [LICENSE](LICENSE).

This is an independent learning/prototype project with no affiliation to any artist, group, or commercial product. Place data, travel times and photos are attributed to their sources; anything still pending manual verification is labelled as such on the page itself.
