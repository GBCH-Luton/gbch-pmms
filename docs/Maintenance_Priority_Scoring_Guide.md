# GBCH PMMS — Maintenance Ticket Priority Scoring Guide

**Purpose of this document:** explain, in plain terms, exactly how the
system decides whether a maintenance ticket is Critical, Urgent, or
Routine — and set out a reviewed, corrected set of category scores so
that "we don't know exactly what's wrong yet" is never treated as less
urgent than a known, mild issue in that same trade.

---

## 1. How a ticket's priority is calculated

Every ticket gets a **priority score** (a number), which is then
translated into a tier:

| Score | Tier | What happens |
|---|---|---|
| 70 or higher | **P1 Critical** | Triggers emergency escalation — the on-call roster is notified immediately. |
| 40 – 69 | **P2 Urgent** | Flagged as urgent, expected to be picked up promptly. |
| Below 40 | **P3 Routine** | Standard queue, no special escalation. |

The score itself is built from up to three layers, added together:

1. **The specific issue selected.** Every category (Electricity,
   Plumbing, Carpentry, etc.) has a list of specific, pre-defined
   issues — e.g. under Electricity: "Power outage — total loss",
   "Socket fault", "Light fitting fault". Each one has its own score,
   set individually based on how serious that specific problem
   typically is. **This is the main driver of priority for almost
   every real ticket**, and — reviewed below — this part of the system
   is already well calibrated.

2. **The category's fallback score ("weight"), used only when the
   specific issue isn't in the list.** If whoever is raising the
   ticket can't find an exact match and picks "Other Unlisted
   [Category] Issue," the ticket falls back to a single score set once
   per category, rather than per specific issue. **This is the part of
   the system this review found to be poorly calibrated**, and is the
   main subject of this document.

3. **A +30 point "high-vulnerability" bonus.** If the property itself
   is flagged as high-vulnerability, every ticket raised against it
   automatically gets +30 points added on top of whatever the issue
   itself scored — this can be enough on its own to push a routine
   issue into the Urgent tier, or an urgent issue into Critical.

There is also a fourth, manual layer: whoever raises a ticket can
**manually override** the calculated tier (force it to P1/P2/P3
directly), for situations the automatic scoring doesn't fit. This is a
deliberate escape hatch, not something this review touches.

---

## 2. What this review found

The category-specific issue scores (layer 1 above) are already
well-designed — for example, every specific Electricity issue scores
80 or higher (automatic P1 Critical), while most Carpentry issues sit
in the 40–70 range (P2 Urgent, except the most serious one). That
correctly reflects that an electrical fault is inherently more
dangerous than a loose door hinge.

**The fallback score (layer 2) is a different story.** Checking every
category against its own specific issues revealed:

- **15 of the 19 categories share the exact same fallback score: 50.**
  That's not a considered per-category decision — it's clearly an
  untouched default that was set once and never revisited.
- The categories that *do* have a custom fallback score are, worryingly,
  some of the more dangerous ones — and they were set **lower** than
  the generic default, not higher: Plumbing (20), Electricity (35),
  Doors/Locks (30), Other/Unlisted Trade (15).

The practical effect: if a builder raises a ticket for, say, an
electrical problem that doesn't match any of the 8 listed electrical
issues, it currently scores **35 points — Routine** — even though
*every single listed electrical issue scores 80 or above (Critical)*.
The same is true, worse, for Plumbing: an unclassified plumbing issue
currently scores **20 — Routine** — while a Burst Pipe scores 140.

## 3. The principle used to fix it

**A category's fallback score should never be lower than the
lowest-scored specific issue already listed in that same category.**

In plain terms: if we genuinely don't know exactly what's wrong, the
system should assume it's *at least* as serious as the mildest thing
we already know can go wrong in that trade — never less. This is
simple to explain, easy to audit, and removes guesswork bias without
requiring any subjective re-judging of every category from scratch.

**A known limitation, worth being aware of:** this rule protects against
the *mildest* known issue in a category, not the *worst*. A category
like Utilities & Supply spans a mild "Smart meter installation" (65)
up to a severe "Gas supply issue" (130) — the fixed fallback can only
be as cautious as the mildest of those, not the most severe. The real,
durable fix for that gap is making sure the specific-issue list stays
comprehensive enough that "unlisted" is rarely picked for something
genuinely serious — the fallback score is a safety net under that list,
not a substitute for it.

---

## 4. Full proposed scoring table

| Category | Current Fallback | Real Issues in this Category (range) | Proposed Fallback | Tier Before → After | Recommendation |
|---|---|---|---|---|---|
| **Plumbing** | 20 | 70 – 140 | **70** | Routine → **Critical** | ⚠ Must fix — worst gap found. A Burst Pipe scores 140; an unclassified plumbing issue should never default to Routine. |
| **Electricity** | 35 | 80 – 130 | **80** | Routine → **Critical** | ⚠ Must fix — the example that started this review. |
| **Compliance & Safety Systems** | 50 | 100 – 140 | **100** | Urgent → **Critical** | ⚠ Must fix — every single listed item here (fire alarms, sprinklers, CO alarms) is already Critical; the fallback should match. |
| **Security & Access Systems** | 50 | 80 – 120 | **80** | Urgent → **Critical** | ⚠ Must fix — lockouts and alarm faults are urgent by nature. |
| **Heating, Ventilation & AC (HVAC)** | 50 | 70 – 120 | **70** | Urgent → **Critical** | ⚠ Recommended fix — covers boiler breakdowns and no-hot-water situations. |
| **Utilities & Supply** | 50 | 65 – 130 | **65** | Urgent → Urgent (closer to real floor) | Recommended fix — narrows the gap, though see the limitation note above regarding Gas supply (130). |
| **Pest Control** | 50 | 60 – 90 | **60** | Urgent → Urgent | Recommended — brings the fallback in line with real severity (infestations are not minor). |
| **Appliance Issues** | 50 | 60 – 80 | **60** | Urgent → Urgent | Recommended — small, low-risk adjustment. |
| **Doors/Locks** | 30 | 35 – 60 | **35** | Routine → Routine | Minor — brings it exactly in line, negligible practical effect. |
| **General Repairs/Handyman** | 50 | 40 – 55 | **40** | Urgent → Urgent | Optional — no safety concern either way. |
| **Property Uplift/Refurbishment** | 50 | 40 – 45 | **40** | Urgent → Urgent | Optional — no safety concern either way. |
| **Carpentry/Joinery** | 50 | 40 – 70 | **40** | Urgent → Urgent | Optional — already reasonably calibrated (this was the original comparison point, and it turned out fine). |
| **Appliance Delivery & Installation** | 50 | 35 – 60 | **35** | Urgent → Routine | Optional — installation/delivery jobs are inherently schedulable, not emergencies. |
| **Redecoration & Finishes** | 50 | 35 – 50 | **35** | Urgent → Routine | Optional — purely cosmetic work. |
| **Private Work** | 50 | 35 – 40 | **35** | Urgent → Routine | Optional — discretionary work, shouldn't default urgent. |
| **Rubbish & Clearance** | 50 | 30 – 70 | **30** | Urgent → Routine | Optional — most items here are low-stakes; genuinely hazardous waste already has its own listed score (70). |
| **Grounds & External Works** | 50 | 30 – 55 | **30** | Urgent → Routine | Optional — grounds work is rarely time-critical. |
| **Housekeeping & Cleaning** | 50 | 30 – 40 | **30** | Urgent → Routine | Optional — cleaning tasks are schedulable, not emergencies. |
| **Other / Unlisted Trade** | 15 | 15 – 45 | **15** | Routine → Routine | No change needed — already correctly set as the lowest, true catch-all. |

**Legend:** "⚠ Must fix" = a real safety/damage-risk gap where an
unclassified issue could currently be under-prioritized in a way that
matters. "Recommended" = a meaningful improvement worth making.
"Optional" = the current setup causes no real-world harm; changing it
only improves internal consistency.

---

## 5. Suggested next step

The six "must fix" / "recommended" rows above (Plumbing, Electricity,
Compliance & Safety Systems, Security & Access Systems, HVAC, Utilities
& Supply, plus Pest Control and Appliance Issues) are the ones where
today's setup could genuinely under-react to a serious, unclassified
problem. Everything else is a matter of tidiness, not safety.

This document is for review and discussion — no changes have been made
to the live system yet. Once agreed, updating these numbers in
Settings → Maintenance Categories takes only a few minutes.
