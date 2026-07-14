# GBCH PMMS — Maintenance Ticket Priority Scoring Guide

**Purpose of this document:** explain, in plain terms, exactly how the
system decides whether a maintenance ticket is Critical, Urgent, or
Routine — reflecting the live system as currently configured.

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
   every real ticket.**

2. **The category's fallback score, used only when the specific issue
   isn't in the list.** If whoever is raising the ticket can't find an
   exact match and picks "Other Unlisted [Category] Issue," the ticket
   falls back to a single score set once per category, rather than per
   specific issue. See the table below for the current value in every
   category.

3. **A +30 point "high-vulnerability" bonus.** If the property itself
   is flagged as high-vulnerability, every ticket raised against it
   automatically gets +30 points added on top of whatever the issue
   itself scored — this can be enough on its own to push a routine
   issue into the Urgent tier, or an urgent issue into Critical.

There is also a fourth, manual layer: whoever raises a ticket can
**manually override** the calculated tier (force it to P1/P2/P3
directly), for situations the automatic scoring doesn't fit.

---

## 2. The guiding rule behind the fallback scores

**A category's fallback score is never lower than the lowest-scored
specific issue already listed in that same category.**

In plain terms: if we genuinely don't know exactly what's wrong, the
system assumes it's *at least* as serious as the mildest thing we
already know can go wrong in that trade — never less. This is simple
to explain, easy to audit, and removes guesswork bias without requiring
any subjective re-judging of every category from scratch.

**A known limitation, worth being aware of:** this rule protects against
the *mildest* known issue in a category, not the *worst*. A category
like Utilities & Supply spans a mild "Smart meter installation" (65)
up to a severe "Gas supply issue" (130) — the fallback can only be as
cautious as the mildest of those, not the most severe. The lasting
protection against that gap is keeping the specific-issue list
comprehensive enough that "unlisted" is rarely picked for something
genuinely serious — the fallback score is a safety net under that list,
not a substitute for it.

---

## 3. Fallback score, by category

| Category | Fallback Score | Tier | Real Issues in this Category (range) |
|---|---|---|---|
| **Electricity** | 80 | Critical | 80 – 130 |
| **Plumbing** | 70 | Critical | 70 – 140 |
| **Compliance & Safety Systems** | 100 | Critical | 100 – 140 |
| **Security & Access Systems** | 80 | Critical | 80 – 120 |
| **Heating, Ventilation & AC (HVAC)** | 70 | Critical | 70 – 120 |
| **Utilities & Supply** | 65 | Urgent | 65 – 130 |
| **Pest Control** | 60 | Urgent | 60 – 90 |
| **Appliance Issues** | 60 | Urgent | 60 – 80 |
| **Carpentry/Joinery** | 40 | Urgent | 40 – 70 |
| **General Repairs/Handyman** | 40 | Urgent | 40 – 55 |
| **Property Uplift/Refurbishment** | 40 | Urgent | 40 – 45 |
| **Doors/Locks** | 35 | Routine | 35 – 60 |
| **Appliance Delivery & Installation** | 35 | Routine | 35 – 60 |
| **Redecoration & Finishes** | 35 | Routine | 35 – 50 |
| **Private Work** | 35 | Routine | 35 – 40 |
| **Rubbish & Clearance** | 30 | Routine | 30 – 70 |
| **Grounds & External Works** | 30 | Routine | 30 – 55 |
| **Housekeeping & Cleaning** | 30 | Routine | 30 – 40 |
| **Other / Unlisted Trade** | 15 | Routine | 15 – 45 |

Every row satisfies the guiding rule above: no category's fallback
score sits below its own lowest-scored listed issue.

---

## 4. Where to change these numbers

These values live in **Settings → Maintenance Categories**, under each
category's own "Fallback score" field. Sub-category scores (the ones
used for specific, listed issues) can be adjusted in the same place,
per issue.
