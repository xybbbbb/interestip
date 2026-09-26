# PRD — Interestip (Interest-Driven Travel Assistant)

**Status:** v1 shipped as a working prototype · **Owner:** xybbbbb (solo product + engineering) · **Last updated:** 2026-09-20
**Live:** <https://xybbbbb.github.io/interest_trip/> · **Repo:** <https://github.com/xybbbbb/interest_trip>
**中文版:** [PRD.zh.md](./PRD.zh.md)

> This document records the product as it was actually decided and built, including the options that were
> rejected and why. It is a working document, not a pitch.

---

## 1. One-liner

Tell it what you're into. It finds the places tied to that interest, shows how much each claim can be trusted,
and schedules them into an itinerary you can actually walk — built around the things you've already booked.

## 2. Problem and insight

**Insight.** People rarely travel to a city; they travel *because of* something. When that's true, the hard part
isn't finding attractions:

- The places tied to that interest are scattered across fan posts, music videos, interviews, blogs and social
  media — with wildly different reliability and no structure at all.
- The moment you have a list, a second problem appears: turning it into something walkable, around a fixed
  commitment, without wrecking the rest of the trip.

**Why the obvious alternatives fail.**

| Alternative | Where it breaks |
|---|---|
| Generic AI travel planner | Optimises for what's popular, so the interest — the whole reason for the trip — gets diluted |
| Doing it by hand with a list | Becomes a pilgrimage checklist: geographically absurd, no room to be in the city |
| Social-media search | Unstructured, unverifiable, and you can't tell a confirmed location from a rumour |

**The bet.** Treat *evidence* as a first-class data structure (source + date + confidence on every place), and
hand scheduling to deterministic code instead of the model. Then a personal trip can also be a feasible one.

## 3. Who it's for

**Primary (v1): someone travelling because of an interest, who already has one immovable commitment.**
The first case: a fan flying to Seoul for a concert, who also wants to visit the places the members have been to —
and still have a normal holiday.

Three traits define this user, and they drive most of the requirements:

1. **One fixed anchor.** There's something booked that can't move; everything else must bend around it.
2. **A long, messy, low-structure candidate list.** They have 20–100 "maybe" places and no way to judge them.
3. **They still want a real holiday.** The interest is the reason for the trip, not the whole itinerary.

**Secondary:** any interest-driven traveller — film locations, food, café trails, hiking. Same three traits,
different content. The second vertical (New York · Art & Culture) exists to test exactly this claim.

## 4. Positioning

```text
Typical:  Destination → Places → Itinerary
Ours:     Interest → Associated places → Destination → Constraints → Personalised journey
```

We deliberately don't compete on breadth. "Which cities do you cover" is a race we'd lose and a question we
don't want to be asked. The questions we do want:

- Does the itinerary understand *why* you're going?
- Can you see where each recommendation came from?
- Is it actually walkable given your one fixed commitment?

## 5. Product principles

These are the decisions that shape everything else; they were also the tie-breakers when features competed.

1. **One immovable thing anchors the trip.** The first question the product asks is not "where do you want to
   go" but "what's already booked". The anchor is a **hard constraint**, not a preference — a concert at 19:00
   means the day winds down before it; a timed museum entry at 10:30 means the day starts from it.
2. **A priority stack, not a pile.** P0 anchor (locked) → P1 places tied to the interest → P2 ordinary
   sightseeing. This is the scheduling order, and it also tells the user what the product values.
3. **Interest should light up a trip, not hijack it.** Ordinary sightseeing is a first-class part of the plan.
   If the output is a pilgrimage with no room to eat, rest or wander, the product has failed.
4. **Evidence is a data structure, not a vibe.** Every place carries source, date and confidence. Confidence
   changes what the UI says and how the place is treated — one-source claims are marked, low-confidence places
   can be hidden in one click.
5. **AI where language helps; deterministic where correctness matters.** LLM: understanding the intent, turning
   messy source material into structured records, writing the "why this place" line. Code: distance, travel
   time, opening hours, route feasibility, clustering. The model never does the trip's arithmetic.
6. **Say "I don't know."** The answer layer must refuse when the sources don't support an answer. A travel
   assistant that invents a place is worse than one that admits a gap.
7. **Candidate data stays labelled as candidate.** Nothing is silently upgraded from "looks right" to "verified".

## 6. What v1 does (shipped)

```text
User states their motivation in a sentence
  → Product shows its priority stack: P0 anchor → P1 interest places → P2 sightseeing
  → User browses candidate places with sources and confidence; marks must-go / on-the-way, multi-selects sights
  → User sets the hard constraints: days, which day is booked, pace, budget, arrival/departure, lodging strategy
  → Engine generates a day-by-day itinerary: geographic clustering → nearest-neighbour → 2-opt → time assignment
  → Map with pins per day; each leg shows real transit time, walk, or an explicit "estimate"
  → Every place opens a drawer with its evidence chain and source links
  → Manual adjustment: drag an item to another day
  → On-site mode: a big local-language place card plus essential phrases for a driver or shop staff
  → Bilingual (Chinese / English) throughout
```

Two verticals ship in the same single-file prototype: **CORTIS × Seoul** and **New York · Art & Culture**.

## 7. Requirements

| # | Requirement | Status | Acceptance criteria |
|---|---|---|---|
| R1 | Intent intake in natural language | ✅ | A one-sentence motivation produces the priority stack and the candidate pools |
| R2 | Anchor as a hard constraint, configurable per vertical | ✅ | Concert 19:00 (`last`): no place scheduled after it. Timed entry 10:30 (`first`): the day starts from it |
| R3 | Evidence & confidence per place | ✅ | Every interest place carries ≥1 source link; one-source places are visibly marked |
| R4 | Selection model | ✅ | Interest places: must-go / on-the-way. Sightseeing: continuous multi-select. Nothing pre-selected by default |
| R5 | Constraint form | ✅ | Days, anchor day, pace cap, budget band, arrival/departure, lodging strategy all affect the output |
| R6 | Deterministic scheduling | ✅ | Same inputs → same itinerary; no impossible leg (arrival vs opening hours / closing time); overflow list for what didn't fit |
| R7 | Real travel times | ✅ | Each leg is labelled real route / walk / estimate; uncovered pairs fall back and say so |
| R8 | Map + per-day view | ✅ | Whole-trip view and per-day colours; clicking a pin opens the place card |
| R9 | Manual adjustment | ✅ | Any non-locked item can be dragged to another day without re-running the whole plan |
| R10 | On-site mode | ✅ | Large local-language name + address + phrases; language follows the vertical |
| R11 | Bilingual UI | ✅ | 中/EN switch covering content, labels and the map legend |
| R12 | Generated recommendation text | ✅ | Per place, per language, generated at build time with the source material attached — not at page load |
| R13 | Answer layer with refusal | ✅ | Answers must cite sources or refuse; measured by an 18-case evaluation set |

## 8. Explicitly out of scope (v1)

Booking, payments, live prices, accounts, server-side saving/sharing, real-time chat agent, aggressive scraping
of social platforms, user-generated place submissions, and more than two verticals. Each of these is a product
in itself; the prototype's job is to prove the core loop.

## 9. Data strategy

| Layer | Source | Rule |
|---|---|---|
| Interest places (fan places) | Curated from public material, semi-automated collection + human review | Every entry keeps its source and a confidence level; never presented as verified |
| Ordinary sightseeing | Official open data (e.g. VisitSeoul OpenAPI) | Official name in both languages |
| Map & place metadata | OpenStreetMap | Attribution (ODbL) required; opening hours are candidate data until checked against a primary source |
| Travel times | Transitous (MOTIS) | Queried at build time, cached into a matrix that ships with the repo; no runtime dependency |
| Recommendation text | LLM, at build time | Generated with the source material in the prompt; API keys never reach the client |

**Deliberate boundary:** no aggressive crawling. Data comes from official APIs, curated public material with
human review, and user submissions. Machine assistance proposes; a human still decides what counts as verified.

## 10. How we'll know it works

v1 has no user data yet — that is the biggest gap, and the next milestone. What we will measure:

| Question | Metric | Current reading |
|---|---|---|
| Can someone finish the task unaided? | % of testers who reach a generated itinerary without help | not measured yet (M5) |
| Is the itinerary actually feasible? | Impossible legs (arrival vs opening hours) per plan | 0 in engine tests |
| Can the user trust a recommendation? | % of scheduled places with a source link; % of legs with real (non-estimated) times | 102 Seoul + 105 New York pairs at 100% coverage |
| Does the product answer honestly? | Refusal correctness / citation accuracy on the evaluation set | 17/18 cases, citation accuracy 85% → 100% after two prompt iterations |
| Did it capture *their* trip? | Qualitative: does the user describe the result as "my trip"? | to be collected in M5 |

## 11. Vertical strategy

Fandom travel is the first vertical, New York · Art & Culture the second. A vertical is a *test of a capability*,
not extra content:

> **Add a vertical only when it validates a new capability — never just to add another example.**

New York earned its place because it changed four things at once: city, interest, data source
(VisitSeoul → OpenStreetMap) and anchor semantics (evening show → timed entry). A third art-museum city would
change nothing. A film-location vertical would — it tests "one work → many scattered scenes", a different data
shape from "one artist → many places".

A new vertical must supply: an anchor type, a place pool with per-place provenance, transit coverage between
those places, and copy in every supported language.

**Rejected, and why** (so the rule has teeth):

- *Coffee / café trail* — rejected. An interest that can't anchor a day collapses into "spend the day in cafés",
  which breaks principle 3. The test isn't "is this interesting", it's "can this produce a day someone would
  actually want to live".
- *Hiking / outdoor* — rejected twice over: the transit assumptions break (trailheads, thin public-transit
  coverage), and a vertical is only as good as the curator's ability to judge the content. A vertical built on
  data I can't evaluate would produce confident nonsense.

## 12. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Fan claims can't be verified at scale | The core value prop *is* reliability | Confidence levels, visible sources, one-source and low-confidence flags, human review before anything is upgraded |
| Free public data sources change or disappear | The prototype depends on them | Cache everything at build time; the transit matrices and place data ship with the repo |
| Over-fitting to fandom | "The framework generalises" would be an untested claim | A deliberately different second vertical |
| The model invents a recommendation | Worse than admitting a gap | Evidence-gated answering, refusal as a first-class outcome, evaluation set run on every prompt change |
| Scope creep that looks like progress | More verticals feel productive but prove nothing new | The rule in §11 |
| Users can't tell demo data from verified data | Destroys trust once discovered | Candidate data is labelled as candidate everywhere it appears, including the footer |

## 13. Milestones

| | Milestone | State |
|---|---|---|
| M1 | Concept, competitive framing, first use case | ✅ |
| M2 | Place + evidence service (MCP, protocol tests 7/7) | ✅ |
| M3 | Interactive prototype on real data (real transit times, scheduling engine) | ✅ |
| M4 | Second vertical + build-time recommendation text + answer layer with an evaluation set | ✅ |
| M5 | **Real-user validation**: 3–5 people run the same task, findings written up | ⬜ next |
| M6 | Verification pass: real venue, fan coordinates, opening hours, place-name checks | ⬜ |
| M7 | Retrieval upgrade (vector search alongside keyword search) to fix the one failing case | ⬜ |
| M8 | End-to-end smoke tests in CI | ⬜ |

## 14. Open questions

1. Is "interest" a filter or a reranker? Today it defines a pool; it might be better as a weight on an
   otherwise ordinary trip.
2. How many anchors can one trip have, and who decides which day the anchor falls on — the user or the product?
3. What is the smallest evidence set that makes a place trustworthy enough to schedule?
4. Should ordinary sightseeing be auto-filled to balance a day, or always explicitly chosen?
5. How should a trip with two interests behave — two pools, or one blended ranking?
6. Where does the product stop: itinerary generation, or through the trip itself (on-site mode is a first step)?
