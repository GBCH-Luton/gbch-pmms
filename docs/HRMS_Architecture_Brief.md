# HRMS Architecture Brief — for building the company's new HR system from scratch

Use this as the starting brief for a brand-new project: **HRMS** (Human
Resource Management System, said as letters — "H-R-M-S," informally
"Herms"). It joins **PMMS** (Property Maintenance Management System)
and **SIMS** (Stock & Inventory Management System) as the third system
in the same family, sharing staff identity, security conventions, and
general shape with both, while living in its own codebase and its own
schema.

This brief assumes whoever (or whichever AI session) picks it up next
has **no prior context** — it needs to set up a new project folder
from scratch, not add to an existing one.

## 1. The company's systems landscape

- **PMMS** (live) — repairs/maintenance, housekeeping/cleaning rota,
  gardens, compliance, void tracking, daily clocking/attendance. The
  original system; sets every convention below.
- **SIMS** (designed, being built) — stock & inventory across
  Maintenance, Office, and IT divisions.
- **HRMS** (this brief) — the company's HR system. Becomes the
  **primary place staff records get created** going forward, owns
  onboarding/offboarding, leave, HR documents/compliance, and
  cross-system role visibility.

All three are meant to feel like one coherent family of tools to
staff — same login experience, same general navigation shape, same
underlying security model, one shared staff identity — while each
staying its own independent codebase/deployment.

## 2. Tech stack & house style (match PMMS/SIMS exactly)

- **Frontend**: React + Vite, plain inline JS style objects (no
  Tailwind or other CSS framework), `react-router-dom` for routing.
  No global state library — local component state only.
- **Backend**: Supabase — Postgres, Supabase Auth (email+password),
  Supabase Storage (file uploads — HR documents, staff photos),
  Supabase Edge Functions (anything needing service-role privileges or
  scheduled cron jobs, e.g. "leave request pending too long" alerts).
- **Schema layout**: `public.staff` holds the shared staff directory
  (see section 6) alongside Supabase's own `auth.users`. Everything
  HRMS-specific lives in its own schema, `hrms` — never touch `pmms`
  or `sims`'s schemas directly.
- **Migrations**: plain numbered/named `.sql` files in a `scripts/`
  folder, each with a comment header explaining what it does and why,
  applied directly against the shared live database. Same audit-trail
  style as PMMS — keep it.
- **Backups**: after each meaningful change, a full data + code
  snapshot (table dumps as JSON, a code archive, a short README on
  what changed and how it was verified).

## 3. Folder / project setup (do this first)

HRMS is a **new, separate project** — not a folder inside the PMMS
repo. Suggested first steps for whoever starts this:

1. Create a new project directory (e.g. `GBCH HRMS`), separate from
   the existing `GBCH PMMS` folder.
2. Scaffold with Vite + React (`npm create vite@latest . -- --template react`).
3. Install `@supabase/supabase-js`, `react-router-dom`.
4. Point it at the **same existing Supabase project** PMMS already
   uses (same URL/anon key) — do not create a new Supabase project.
   Ask for the project's Supabase URL/anon key rather than guessing
   them.
5. Create the `hrms` schema in that shared project, plus a `scripts/`
   folder for its migrations, mirroring PMMS's own `scripts/` layout.
6. Set up its own `git` repo, its own deployment (wherever PMMS itself
   is hosted — ask rather than assume it's the same host/target).

## 4. Authentication & access provisioning (must match exactly)

- Email + password sign-in via Supabase Auth. **No self-service
  "forgot password"** — same "contact your manager or admin" pattern
  as PMMS.
- Adding a new person creates both a Supabase Auth user and a
  `public.staff` directory row, with a generated temporary password
  given directly (never emailed). Forced "set your own password" on
  first login, same as PMMS.
- "Removing" access always means **deactivating**, never deleting —
  their history stays intact, their login isn't destroyed.
- A person's **Role** (per-system, see section 6) determines their
  access level — separate from job title, which is just descriptive.
- **Staff creation ownership**: HRMS becomes the intended primary
  place to add a new staff member going forward. PMMS's own existing
  "Add Staff" (under its Admin page) **stays in place as a fallback
  during rollout** — do not ask PMMS to remove it yet. Revisit
  removing it from PMMS only once HRMS is trusted and in real use.

## 5. The division-scoping security pattern (replicate exactly)

- Roles are named things (e.g. "HR Manager," "Department Head") stored
  as data, each carrying an access level and **optionally** a
  division/department tag.
- **No division tag = sees everything** ("unscoped") — deliberate
  default so adding scoping later never silently locks someone out.
- **A division tag = restricted** to just that division's data,
  everywhere — dashboards, lists, dropdowns, and every write action —
  enforced both client-side (UX) and server-side (real security).
- Enforcement via Postgres **Row Level Security**, driven by a small
  number of `SECURITY DEFINER` SQL helper functions resolving "who is
  this," "what access level," "what division" from the caller's auth
  token. Build HRMS's own copies of these functions in the `hrms`
  schema — do not reuse or modify PMMS's `pmms.*` versions.
- Same lesson learned building PMMS, worth repeating: a missing RLS
  policy is a real security hole, not just a display bug. Every new
  page/feature needs both layers from day one.

## 6. Shared staff identity & cross-system data flow

**Same confirmed approach as SIMS**: one shared Supabase project, one
schema per system. HRMS gets schema `hrms`. All three systems share
`public.staff` / `auth.users` — one person, one login, one identity.

- **HRMS becomes the primary writer** of `public.staff` going
  forward (name, job title, contact info, active/inactive) — PMMS and
  SIMS become readers of it for their own purposes, same as today,
  just with HRMS as the intended front door for new starters/leavers
  once trusted (see section 4's rollout note).
- **Per-system roles stay separate**, per the SIMS brief's own
  resolved default: each system keeps its own division-tagged role
  table in its own schema (`pmms.staff_roles`, an equivalent
  `sims.staff_roles`, and HRMS's own `hrms.staff_roles` for
  HR-specific roles like "HR Manager"). A single person can hold
  different roles in different systems against the one shared
  identity. HRMS's job is to be **one place to see all of them** — a
  read-only rollup across `pmms.staff_roles`/`sims.staff_roles`/
  `hrms.staff_roles` on a person's HRMS profile page — not to own or
  edit another system's role assignments directly.
- **Onboarding/offboarding checklists** live in HRMS and are the
  concrete answer to the open question the SIMS brief left dangling
  ("where does the request that triggers an onboarding/offboarding
  checklist actually come from?"). HRMS should expose a clear
  "start onboarding/offboarding for this person" flow, and SIMS's own
  equipment issue/collect + Data Retention Hold steps (see the SIMS
  brief, section 7.9) are meant to be triggered from here — likely a
  small Edge Function or a cross-schema call SIMS exposes for HRMS to
  invoke, not HRMS reaching directly into SIMS's tables.
- **Future item, not v1**: HRMS reading PMMS's daily clocking/
  attendance data (`pmms.daily_attendance`) to surface staff clocking
  KPIs (hours worked, lateness, etc.) inside HRMS's own dashboard.
  This is a straightforward **read-only cross-schema query** (through
  a scoped view, respecting PMMS's own RLS) — the same "no API call
  needed, it's just SQL against another schema in the same database"
  pattern already established for PMMS↔SIMS. Attendance/clocking
  itself stays owned and recorded in PMMS (it's tied to job-site GPS/
  property visits) — HRMS only ever displays it, never writes to it.
- Any cross-schema **write** (not just a read) should go through a
  dedicated, narrowly-scoped `SECURITY DEFINER` function or Edge
  Function — never broad direct write access into another system's
  tables. Do not modify PMMS's or SIMS's existing schema, functions,
  or RLS policies to make any of this work.

## 7. UI/UX conventions

- Left-hand sidebar navigation, main content to the right — same
  structural shape as PMMS.
- **Different colour theme from both PMMS (greens/navy) and SIMS
  (amber/steel-grey or industrial-blue)** — the shape of the UI should
  read as the same family of tools, the colour shouldn't. Pick
  something that reads as "people/HR" rather than
  maintenance/warehouse — a warm, approachable palette (e.g. a soft
  teal-plum, or a warm indigo) would fit well; avoid landing on
  anything too close to either sibling system's palette.
- Dashboard-style landing page with KPI tiles that double as filters
  (click a tile, jump to the filtered list) — same pattern as PMMS's
  own Dashboard KPI tiles.
- A **Daily Briefing**-equivalent panel: same collapsible,
  flagged-vs-quiet-line format as PMMS's, but HR-flavoured content —
  new starters this week, leavers, leave requests pending approval,
  documents/certifications expiring soon, onboarding/offboarding
  checklists stalled. Reuses the same "flagged items first, a quiet
  line once everything's clear" shape, not the same content.
- A **"Recent Activity"** panel in the same visual slot as PMMS's
  "Where's the Team" card — but reimagined for HR content, not
  location tracking. Think a plain timestamped feed: "Jane Smith
  started onboarding," "Leave approved for Tom," "DBS check expiring
  in 14 days for Aisha" — not a map or live position, which is
  meaningless for an HR system.
- A **Settings** page matching PMMS's own shape (configurable alert
  thresholds — e.g. how many days before a document expiry counts as
  "due soon," same idea as PMMS's Compliance Alerts setting).
- Filterable, sortable tables with expandable rows for detail/actions,
  same as PMMS's Pipeline-style pages.
- Accordion-style collapsible sections for reference/help content
  (mirror PMMS's own Help & Guide page structure).

## 8. Scope for v1

**In v1:**
1. **Staff directory** — add/edit/deactivate, job title, contact +
   emergency contact info, photo. Writes to `public.staff`.
2. **Onboarding/offboarding checklists** — see section 6.
3. **Leave & absence** — request/approve annual leave and sick leave,
   with a calendar view. This is a real gap today: PMMS only has a
   flat "On Leave/Sick" availability flag, no request/approval
   workflow behind it.
4. **HR documents & compliance** — contracts, right-to-work checks,
   DBS checks, certifications/training records, each with an expiry
   date and the same due-soon/expired alert pattern PMMS already uses
   for property compliance certificates (reusable design, not a new
   concept — copy that pattern's shape).
5. **Cross-system role rollup** — read-only view of a person's roles
   across PMMS/SIMS/HRMS (see section 6).
6. **Dashboard + Daily Briefing + Recent Activity + Settings**, per
   section 7.

**Explicitly out of scope for v1** (deliberate, not forgotten):
- **Payroll** — regulatory/financial complexity, almost certainly a
  dedicated payroll product integrated later, not built in-house here.
- **Performance reviews / recruitment / applicant tracking** — real
  future HR features, not urgent for a first version.
- **Attendance/clocking** — stays owned by PMMS (see section 6's
  future-item note on reading it, not owning it).

## 9. What's being asked of whoever picks this up

Please propose, at the concept/design level first (not full
implementation yet):

1. A concrete data model for `hrms` schema: staff-facing tables for
   onboarding/offboarding, leave requests, HR documents, and the
   cross-system role rollup described in section 6.
2. The core user flows: adding a new staff member (and the temporary
   coexistence with PMMS's own Add Staff during rollout, per section
   4), running an onboarding/offboarding checklist end to end,
   requesting and approving leave, and how a document's expiry alert
   actually reaches someone (in-app + push/email, matching PMMS's
   existing alert conventions — check PMMS's Help & Guide page,
   "Alerts you can tune in Settings," for the pattern to copy).
3. Exactly how division/department-based access and RLS should be
   structured in the `hrms` schema, consistent with section 5.
4. A concrete design for the section 6 cross-system flows: the
   role-rollup read, and the onboarding/offboarding → SIMS equipment
   trigger.
5. A first-pass colour theme + component style for the UI, consistent
   with section 7's constraints (distinct from both siblings).
6. Flag anywhere this brief is ambiguous or a human decision is needed
   before locking in a design — don't guess silently on anything
   involving another system's data or access.
