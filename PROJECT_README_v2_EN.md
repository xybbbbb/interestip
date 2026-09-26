# Interest-Driven Travel Assistant

> **Turn what you love into where you go.**

An AI-powered travel assistant that doesn't just help you visit a city — it helps you turn the places connected to **what you love** (an artist, a show, an interest) into a real, feasible trip.

The project started with a very personal question:

> “If I'm traveling to Seoul for a CORTIS concert, why can't my itinerary also include the places they've been, the cafés they've visited, and the spots where their music videos were filmed?”

The first vertical is **fandom travel**: CORTIS × Seoul. Underneath it, the project explores a broader framework of interest-driven travel that could also apply to film locations, café trails, food journeys, sports trips, hiking routes, and more.

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

Fandom travel is just the first vertical — a way to test whether this framework works.

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
User states their motivation (CORTIS + concert + Seoul trip)
  → System shows priorities: P0 concert → P1 related places → P2 sightseeing
  → User marks fan places “must-go / nice-to-have” and multi-selects sights (continuous selection)
  → Answers days, concert date, pace, budget, arrival/departure, lodging strategy
  → Generates a map-based itinerary: full-trip overview by default, per-day view toggle
  → Concert day automatically leaves time free after 7 PM
  → Recommends the best place to stay per day (adjustable day by day)
  → Low-confidence places can be hidden with one click and show a ⚠ warning in the plan
  → Basic manual adjustments: move an item to another day
```

**Live prototype:** <https://xybbbbb.github.io/interest_trip/>

> ⚠️ Every place, piece of evidence, hotel suggestion, and route in the prototype is placeholder demo data. It exists to validate the product pipeline, not to represent verified research findings.

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

- Natural-language preference understanding
- Information extraction and entity identification
- Recommendation reasoning and itinerary explanations
- Conversational itinerary adaptation

### Structured Data

- Places, coordinates, opening hours, events
- Evidence and source metadata
- User preferences

### Deterministic Systems (planned, not yet built)

- Distance calculation
- Travel time
- Route feasibility
- Opening-hours and schedule conflict checks
- Geographic clustering

Core design principle:

> **Use AI where language understanding and reasoning add value; use deterministic systems where correctness must be deterministic.**

---

## 5. Current Technical Progress (Sep 2026)

### References

- Academic references: AgentTravel, TravelPlanner (studied for planning algorithms and deterministic constraints; not used as code bases).

### Done

- ✅ Standalone **interest-mcp** module (Node.js, zero third-party dependencies, MCP Streamable HTTP protocol): interest-place + evidence service. Protocol smoke tests: 7/7 passed.
- ✅ CORTIS × Seoul demo dataset (places with evidence chains and high/medium/low/no confidence, all clearly marked as Demo).
- ✅ Interactive product prototype (map-based itinerary overview, per-day toggle, lodging recommendations, evidence flags), published on GitHub Pages.
- ✅ Prototype UX finalized; skipping Figma and large-scale UI testing to move straight to real data.
- ✅ VisitSeoul integration plan: field-mapping document + fetch script skeleton ready, waiting for the API key.

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

---

## 6. Roadmap

```text
✅ Concept: from generic AI travel planner to interest-driven travel
✅ Competitive analysis and differentiation
✅ First use case: CORTIS × Seoul
✅ Standalone implementation (no external app base)
✅ Interest place + evidence service prototype (MCP, 7/7 tests passed)
✅ Product UI prototype published on GitHub Pages
✅ VisitSeoul integration plan (field mapping + fetch script)
⬜ Import real VisitSeoul sightseeing data (waiting for API key)
⬜ CORTIS fan-place collection & evidence verification pipeline (first real data)
⬜ YouTube Data API search for official content (metadata layer)
⬜ Image-recognition-assisted verification (visual matching, evidence only)
⬜ Deterministic scheduling engine (distance / travel time / opening hours / conflicts)
⬜ Confidence-driven itinerary weighting
⬜ Real-user validation and iteration
⬜ Expand to more interest verticals
```

---

## 7. Project Status

**Phase:** Product discovery → MVP prototype → real data integration

**Concept:** Interest-Driven Travel Assistant

**First use case:** CORTIS × Seoul (fandom travel)

**Live prototype:** <https://xybbbbb.github.io/interest_trip/>

**Next steps:** receive the VisitSeoul API key → import real sightseeing data → build the first verified CORTIS place → validate with real users

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

This is an independent learning/prototype project with no affiliation to any artist, group, or commercial product. All places and evidence in the demo data are placeholders.
