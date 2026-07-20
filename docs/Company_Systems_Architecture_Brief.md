# Company Systems Architecture Brief — for designing a companion system to PMMS

Use this as context when designing a new system that needs to work
alongside PMMS (Property Maintenance Management System) and share
staff, security conventions, and eventually data, with it.

## 1. The company's systems landscape

**PMMS** (already built, Property Maintenance Management System) is
the first of what will become a small family of internal systems for
the same company:

- **PMMS** — repairs/maintenance, housekeeping/cleaning rota, gardens,
  compliance, void tracking. Already live in testing (not yet
  deployed for real staff use).
- **SIMS — Stock & Inventory Management System** (the one being
  designed now, schema name confirmed as `sims`) — 3 divisions:
  **Maintenance** (parts/materials for repair jobs), **Office**
  (chairs, tables, towels, fridges, kettles, etc.), and **IT equipment**
  (mice, keyboards, laptops, monitors, etc. as physical stock/assets).

Both are meant to feel like one coherent family of tools to staff, not
two unrelated products — same login experience, same general
navigation shape, same underlying security model, sharing one staff
identity.

## 2. Tech stack & house style (what PMMS is built with)

- **Frontend**: React + Vite, plain inline JS style objects (no
  Tailwind/CSS framework), `react-router-dom` for routing. No global
  state library — local component state only.
- **Backend**: Supabase — Postgres database, Supabase Auth
  (email+password), Supabase Storage (file uploads), Supabase Edge
  Functions (for anything needing elevated/service-role privileges or
  scheduled cron jobs).
- **Schema layout**: `public.staff` holds the staff directory,
  alongside Supabase's own `public`-adjacent `auth.users`. Everything
  else lives in its own dedicated schema (PMMS uses `pmms`) — kept
  separate from `public` deliberately.
- **Migrations**: plain numbered/named `.sql` files in a `scripts/`
  folder, each with a comment header explaining what it does and why
  — applied directly against the live database (not via a Docker-based
  local dev loop, which may not be available in the build
  environment). This audit-trail style of migration is worth keeping
  for any new system in the family.
- **Backups**: after each meaningful change, a full data + code
  snapshot is taken (table dumps as JSON, a full code archive, and a
  short README explaining what changed and how it was verified).

## 3. Authentication & access provisioning (must match exactly)

- Email + password sign-in via Supabase Auth. **No self-service
  "forgot password"** — the login screen says "Forgotten your
  password? Contact your manager or admin" by design.
- An admin adds a new person (name, email, job title, a Role) — this
  creates both a Supabase Auth user and a staff directory row, with a
  generated temporary password the admin gives them directly (never
  emailed).
- On first login (or after any admin-triggered password reset), the
  person is forced onto a "set your own password" screen and cannot
  access anything else in the system until they do.
- "Removing" someone's access always means **deactivating**, never
  deleting — deactivating flips a flag that blocks them at the
  application level while their history (jobs, records, whatever the
  system tracks) stays fully intact. Their underlying login isn't
  destroyed.
- A person's assigned **Role** determines their access level (e.g.
  no-login / builder-equivalent / manager-equivalent / admin) — this
  is completely separate from their job title, which is just
  descriptive company information.

## 4. The division-scoping security pattern (the core mechanism to replicate)

This is the pattern that makes "whoever logs in only sees their own
division" work in PMMS, and it should be replicated exactly, not
reinvented:

- Roles are named things (e.g. "Maintenance Manager", "Stock
  Controller") stored as data, each carrying: an access level, and
  **optionally** a division tag (e.g. "Maintenance", "Housekeeping").
- **No division tag = sees everything** ("unscoped") — this is
  deliberately the default/backwards-compatible behavior, so adding
  division-scoping to a role never silently locks someone out unless
  it's explicitly configured.
- **A division tag = restricted** to just that division's data across
  every relevant page: dashboards, lists, dropdowns, and the ability
  to act on things (e.g. claim a job, edit a record) outside the
  division is blocked both in the UI *and* enforced server-side.
- Enforcement happens via **Postgres Row Level Security (RLS)**,
  driven by a small number of `SECURITY DEFINER` SQL helper functions
  that look up the calling user's identity from their auth token, e.g.
  (conceptually): "who is the currently logged-in staff member",
  "what access level do they have", "what division are they scoped
  to". Every table's RLS policies are built from these same three
  answers — an unscoped-manager policy, a division-scoped-manager
  policy, and a builder-equivalent policy that only sees their own
  records.
- **Important lesson learned building PMMS**: it's easy to add a new
  division-scoped feature (a new page, a new dropdown, a new dashboard
  tile) and forget to actually gate it — client-side dropdowns/pages
  leaking data outside someone's division is a *display* bug, but a
  missing RLS policy is a *real security hole* (someone could still
  claim/edit something outside their division even if the UI never
  offered it to them). Any new system should build both layers from
  the start: a client-side filter for a good UX, AND a server-side RLS
  policy so it's enforced no matter what.

## 5. UI/UX conventions

- Left-hand sidebar navigation, main content to the right — same
  structural shape as PMMS.
- Dashboard-style landing page with KPI tiles that are also filters
  (click a tile, jump to the filtered list).
- Filterable, sortable tables with expandable rows for detail/actions.
- Accordion-style collapsible sections for reference/help content.
- **Use a different colour theme for this new system** — not PMMS's
  greens or its navy-blue login screen. Something that reads as an
  inventory/warehouse system instead (an amber/steel-grey or
  industrial-blue palette would fit well) — the *shape* of the UI
  should feel like the same family of tools, the *colour* shouldn't.

## 6. How the systems should actually talk to each other

This is the part that needs the most careful design, since staff,
data, and actions need to flow between systems, not just look similar.

**Confirmed approach: one shared Supabase project, one schema per
system.** PMMS's data stays in its `pmms` schema untouched; the new
Stock & Inventory system (SIMS) gets schema `sims`. Both share the
same `public.staff` / `auth.users` — **one person, one login, one
identity**, across every system, rather than duplicate staff records
that can drift out of sync.

Why this over separate Supabase projects per system: Postgres can
query across schemas natively within one database — a read like
"which materials were logged against this repair job" or "does this
staff member's account exist and are they active" doesn't need an
API call or a webhook, it's just a normal SQL query (through a scoped
view, respecting RLS) against another schema in the same database.
Separate projects would mean rebuilding staff/auth sync from scratch
and needing service-role API calls just for basic reads — much more
moving parts, much more that can drift out of sync or fail silently.
Only choose separate projects if there's a hard requirement to keep
them isolated (e.g. separate billing/ownership) — flag this back to
me if that constraint exists, since it changes the design meaningfully.

**Concretely, data should flow both ways:**
- **PMMS → Stock**: a builder completing a repair ticket should be
  able to log which Maintenance-division materials/parts they used,
  which decrements Stock's inventory for that item. PMMS's existing
  "Stock" nav page (currently just a placeholder) is where this would
  eventually surface.
- **Stock → PMMS**: when raising or assigning a maintenance job, it
  should be possible to see live stock availability for materials that
  job might need, without leaving PMMS.
- **Shared staff identity, everywhere**: any system's "who is this
  person, what's their role/division, are they active" question
  should resolve against the one shared `public.staff` table — never
  a per-system duplicate.
- **Cross-schema writes** (like the "decrement stock on job
  completion" example) should go through a dedicated, narrowly-scoped
  `SECURITY DEFINER` function or a small Edge Function — not by
  granting one system's users broad write access into another
  system's tables directly. This keeps each system's own RLS boundary
  intact even when they're transacting with each other.
- **Do not modify PMMS's existing schema, functions, or RLS policies**
  to make this work — build the new system's own schema, own helper
  functions, and own policies alongside it. Postgres namespaces
  functions/policies by schema, so there's no naming collision risk
  even with very similarly-named helper functions in each schema.

**One open design question worth resolving explicitly** (don't assume
an answer, ask): is "division" one single shared concept across every
company system (so "Maintenance" means the same thing everywhere), or
does each system define its own divisions that just happen to share
names in some cases (PMMS's Housekeeping division isn't a stock
division at all, for instance)? The safer default is: each system
keeps its own division-tagged roles in its own schema, but a single
human can be assigned relevant roles across multiple systems — e.g.
someone could be "Maintenance Manager" in PMMS and also "Stock
Controller (Maintenance division)" in Stock, as two separate role
assignments against the same one staff identity.

## 7. IT division — reference features from a working prototype

A working HTML/JS prototype already exists covering asset/stock
management for the IT side of the business (built separately from
this brief). That prototype also contains a helpdesk-ticketing and
developer-sprint-management module — **that part is a different
system and is deliberately excluded here.** Only the asset/stock
management features below are in scope for SIMS's IT division; treat
everything in this section as validated reference material (a real
working proof of concept), not just a suggestion.

**Which of these apply to all 3 divisions vs. IT only** is called out
per item — don't assume everything here is IT-specific by default,
but don't assume it all generalises either.

### 7.1 Asset/item data model (applies to all 3 divisions, with variations)

Every stock item — whether a Maintenance part, an Office chair, or an
IT laptop — carries: category, make/model, serial or asset tag,
owning department/division, status, assigned-to (person or
"Unassigned"), condition, quantity, a minimum-stock-alert threshold,
unit price, purchase date, warranty expiry (where relevant), a
PO/order reference, a supplier link, free-text notes/flags, and a
running **history log** (a plain timestamped list of everything that's
happened to this specific item/unit — purchased, assigned, returned,
repaired, decommissioned). This history log is what makes an asset's
page tell a complete story at a glance, not just its current state —
worth keeping for all 3 divisions, not just IT.

The prototype models categories as a flat list per division (for IT:
Computers & Laptops, Mobile Phones, Tablets, Monitors & Displays,
Keyboards, Mice, Headsets & Audio, Webcams, Docking Stations, Computer
Stands, Phone Cases, Phone Chargers, Cables & Adapters, SIM Cards,
Power Banks, Networking Equipment, Printers & Scanners, Storage
media, Other) — the same shape should exist for Maintenance and
Office, with their own category lists.

**Status values differ by how "serious" an item is**: simple
consumables mostly move through New → Storage → In Use → Returned;
higher-value/data-bearing items (see 7.3) also need Under Repair,
Decommissioned, On Hold, and Legal Hold.

### 7.2 Issuing & requesting equipment (applies to all 3 divisions)

Two related but distinct flows:
- **Equipment Request** (a staff member asking for something): item
  category, specific model (optional), quantity, required-by date,
  requester name, department, and a justification/reason. Goes
  through Pending Approval → Approved → then either **Issue
  directly** (if in stock) or **Raise a Purchase Order** (if not) →
  Issued. Can also be Rejected with a reason.
- **Issue Equipment** (the actual act of handing something out,
  whether or not it started as a request): pick the asset/item (shows
  live stock available), who it's going to, their department, issue
  date, quantity, and a staff acknowledgement/notes field. Issuing
  decrements stock, updates the asset's history, and logs the audit
  trail — this is the one place stock quantity actually changes down.

### 7.3 Data Retention Hold & Legal Hold (IT-specific — not needed for Maintenance/Office)

This is the most important IT-only nuance in the whole prototype and
is worth designing in from the start, not bolted on later. When a
data-bearing device (laptop, phone, tablet, USB/external storage) is
returned — most commonly via **staff offboarding** — it does not go
straight back into available stock. It gets a **hold** first:
- **Standard Data Retention Hold**: a configurable number of days
  (default 30) during which the device cannot be wiped, reissued, or
  decommissioned. Fields: reason, expiry date, who it was held for,
  who authorised the hold, notes.
- **Legal Hold**: no expiry date at all — requires explicit
  authorisation (e.g. from HR/legal) to release, for cases like an
  ongoing investigation. Converting a standard hold into a Legal Hold
  is a one-way action available at any time before release.
- Actions on a held device: **Release Early** (requires picking a
  reason from a list — e.g. "no sensitive data", "backed up and
  verified", "urgently needed for a new starter" — plus what happens
  to the device next: wipe and return to stock, storage as-is, repair,
  or decommission), **Extend** (add more days, with a reason),
  **Convert to Legal Hold**.
- This should **only apply to IT's data-bearing categories** —
  Maintenance parts and Office furniture have no equivalent concept,
  since they carry no company data.

### 7.4 Return & Disposal governance (applies to all 3 divisions, disposal step is IT-heaviest)

A Return form (asset, returned-by, return date, condition on return,
reason for return, and the next action: back to storage / send for
repair / decommission) is common to all divisions. **Decommissioning**
specifically gets an extra governance step everywhere it applies, but
matters most for IT: a disposal reason (end of life, damaged beyond
repair, lost, stolen — police report filed, replaced, donated), an
approving manager's name and date, and — for IT specifically — a
mandatory "has the data been wiped?" confirmation before the item can
be marked permanently decommissioned, plus a checkbox explicitly
confirming the action is understood to be irreversible.

### 7.5 Purchase Orders & Supplier Directory (applies to all 3 divisions)

- **Suppliers**: name, category/specialism, contact name or team,
  phone, email, account/reference number, website, payment terms,
  any discount/agreement, notes (e.g. contract renewal dates), a
  preferred-supplier flag, and active/inactive (never delete a
  supplier record, deactivate it — same principle as staff).
  A "Spend Analysis" view breaks total spend down by supplier.
- **Purchase Orders**: supplier, department, item description, unit
  price, quantity, auto-calculated total, status (Pending/Delivered),
  request date, required-by date, a link to the supplier's product
  page, an uploaded receipt/invoice file, and notes/justification. A
  PO renders as an actual formatted document (company header, PO
  number, line items, total, tracking number, attached receipt) with
  a print/download action — worth having a real "PO document" view,
  not just a database row, since this is often what actually gets
  sent to or filed with a supplier.
- Starting a new PO directly from a supplier's own page (pre-filling
  their details) is a nice touch worth keeping.

### 7.6 Maintenance Schedules (applies best to IT and Office; less relevant to Maintenance-division consumable parts)

Recurring upkeep tasks tied to a specific asset: type (e.g. Annual
Check, Software Update, Deep Clean, Battery Check/Replacement,
Security Audit, Warranty Review), assignee, due date, a repeat
cadence (one-time, every 3/6 months, yearly, every 2 years), and
notes. Completing a task auto-schedules its next occurrence based on
the repeat cadence and appends to the asset's history — this
"auto-reschedule on completion" pattern is worth keeping generally. A
genuinely good automation worth replicating: **a "Warranty Review"
maintenance task is auto-created whenever an asset's warranty is
within 30 days of expiring**, if one doesn't already exist — nobody
has to remember to check. A calendar view (month grid, colour-coded
overdue vs. upcoming) is a nice-to-have on top of the list view.

This concept mostly applies to durable equipment (laptops, monitors,
office equipment) — Maintenance-division parts are typically consumed
on a job rather than maintained in place, so this may not need to
exist for that division at all.

### 7.7 Depreciation & Budget forecasting (durable equipment only — not Maintenance-division consumable parts)

Each category carries an **expected lifespan in years** (e.g.
laptops ≈ 4yr, monitors ≈ 6yr, phones ≈ 3yr). Current value is
calculated as a straight-line depreciation: `price × (1 − age ÷
lifespan)`. Worth surfacing: total original vs. current value
portfolio-wide, assets flagged for review once they're heavily
depreciated (e.g. ≥90%) vs. ones to plan for next budget cycle
(70–89%), a per-category depreciation breakdown, and a **replacement
cost forecast** (near-term vs. next-cycle spend needed) — genuinely
useful for budget planning conversations, not just a vanity metric.
A separate department-level spend/value breakdown (asset value +
order spend by department, as a simple table and bar chart) rounds
this out.

This only makes sense for higher-value durable items (IT equipment,
office furniture) — not for Maintenance parts, which are consumed
rather than owned-and-depreciated.

### 7.8 QR codes & physical asset labels (applies to all 3 divisions, most valuable for IT/Office)

Every individually-tracked asset gets a unique QR code encoding a
link straight to its record — scan with any phone camera, no app
needed, and land on that asset's page (view its status, process a
return, report an issue, reprint its label). A label generator lets
you pick a label sheet size to match what's physically on hand
(reference sizes from the prototype: ~99×38mm for laptops/monitors,
~63×38mm for phones/keyboards, ~46×11mm for small items like cables,
~199×143mm for storage boxes/racks), choose between "individual asset"
labels (assigned-to + department shown) or "bulk stock item" labels
(quantity shown instead), filter by department, preview a single
label before printing, and print a full sheet of the selected items
at once. A "scan simulator" (type/paste the ID instead of an actual
camera scan) is a reasonable way to test/demo this without needing
real hardware or a live QR scanning integration yet.

### 7.9 Staff ↔ equipment linkage (onboarding/offboarding)

Equipment issuance and collection are natural side effects of
**onboarding** and **offboarding** a staff member, not separate
manual busywork:
- **Onboarding**: a checklist that includes issuing a laptop/phone/
  accessories from stock and recording a signed acknowledgement,
  alongside non-stock IT setup steps (accounts, access, etc. — those
  belong to whichever system handles account provisioning, not SIMS).
- **Offboarding**: a checklist that lists every asset currently
  assigned to that person (for collection), and on completion
  **automatically triggers the Data Retention Hold workflow (7.3)**
  for their data-bearing devices rather than just returning them to
  stock — this is the concrete mechanism that ties "a person leaves"
  to "their equipment gets governed correctly," and is worth
  preserving as an explicit, automatic step rather than something a
  person has to remember to do separately.
- Where the request that triggers an onboarding/offboarding checklist
  actually comes from (a support ticket, an HR system, direct entry in
  SIMS) is outside this brief's scope — just design SIMS so it exposes
  a clear "start onboarding/offboarding for this person" action that
  something else can call into, rather than assuming it's always
  triggered by hand inside SIMS itself.

## 8. Known gaps — resolve these before finalizing a design

Sections 1–7 are a strong foundation, but they're not the whole
picture yet. The following gaps were identified by reviewing this
brief critically against what "a proper inventory system" actually
needs for a property-management company specifically (not just what
the reference prototype happened to cover, since that prototype was
built around a single-office IT department, not a multi-property
Maintenance operation). Resolve these — or at least make a deliberate
decision on each — before treating any resulting design as final.

### 8.1 Physical location / multi-site stock — the single biggest gap

Everything in section 7 tracks *who* has an item and *what state*
it's in, but never *where it physically is*. That's fine for a single
office's IT store cupboard, but doesn't fit Maintenance stock at all
for a company managing many properties. Before any data model is
locked in, decide: is Maintenance stock held in one central
warehouse, distributed across each builder's van, kept in small stores
at larger sites, or some mix? This decision determines whether the
schema needs a `location`/`site` concept and a **stock transfer**
action (moving quantity from one location to another), not just the
"issue to a person" model section 7 currently describes. Office and
IT stock may reasonably stay single-location (one store), but this
should be a stated decision, not an accidental omission.

### 8.2 Stock-take / reconciliation

System-recorded quantity will drift from physical reality over time
(breakage, miscounts, undocumented use, theft). Nothing in section 7
covers periodically counting what's actually on the shelf and
reconciling the system to match. A proper inventory system needs a
**stock adjustment** action — a deliberate, logged change to a
quantity with a required reason (found extra, damaged, lost, count
correction) — distinct from the ordinary issue/return flow, so
shrinkage is visible and auditable rather than silently absorbed into
"someone must have taken it."

### 8.3 A field-friendly view, not just a desktop admin console

The reference prototype (section 7) is entirely a desktop admin
screen. PMMS's builder-facing experience is deliberately mobile,
simple, and job-list-shaped (see section 5) — not the dense
multi-column admin tables the prototype uses throughout. If a builder
needs to check what's in their van, request materials for a job, or
mark something used while on-site, SIMS needs an equivalent simple
mobile view for that division/role, matching PMMS's own
builder-vs-manager split in spirit, not just importing the prototype's
admin-only screens wholesale.

### 8.4 Proactive alerts, not just an in-app bell

Section 7's alerting (a bell icon, an in-app alerts modal) only helps
if someone happens to be looking at the screen. PMMS already solves
this class of problem with actual push/email notifications for
low-stock-style alerts (compliance expiry, stuck tickets, void aging
— see the Help & Guide's "Alerts you can tune in Settings" for the
existing pattern). SIMS should get the same treatment for: low stock
crossing its threshold, a data retention hold expiring, a pending
approval sitting too long, and maintenance coming due — not just a
badge nobody sees until they open the app.

### 8.5 Bulk data import for go-live

Whatever stock/assets are currently tracked informally (spreadsheets,
memory, paper) needs a real path into SIMS on day one. Manually
re-entering hundreds of items one at a time through the Add Item form
isn't realistic. A CSV/bulk-import capability (with validation and a
preview-before-committing step) should be part of the initial build,
not an afterthought — this is the same problem PMMS itself had to
solve once for its own property/staff data.

### 8.6 Finer-grained permissions within a division

Section 4's division-scoping controls *which* division's stock
someone sees, but says nothing about *what they're allowed to do*
within it. Should everyone in the Maintenance division be able to
edit unit prices, delete an asset outright, or approve their own
equipment requests — or is there a split (e.g. "can request" vs. "can
approve/issue" vs. "can edit the catalog and pricing")? This mirrors
PMMS's own manager/builder access-level split (section 3) and should
get the same deliberate treatment here, rather than treating "in the
Maintenance division" as one flat permission level.

### 8.7 Reserved vs. available stock

"5 in stock" and "5 available" aren't the same thing once an item can
be earmarked for an upcoming job before it's physically taken. Section
7.2's low-stock alert is based on raw on-hand quantity only. A proper
system needs to distinguish **on-hand quantity** from **available
quantity** (on-hand minus anything already allocated/reserved against
a specific upcoming job or request), so the low-stock alert and the
"can I fulfil this request" check both reflect reality, not just a
raw count that ignores commitments already made against it.

### 8.8 Unit of measure / fractional quantities

"Quantity" as a plain whole number works for discrete items (a
keyboard, a chair) but not for Maintenance materials like pipe, cable,
or paint, which are naturally measured in meters, liters, or partial
boxes. The data model needs a unit of measure per item (each / box /
meter / liter / etc.) alongside quantity, not an assumption that
everything is a whole countable unit.

### 8.9 Returning an item to the supplier, not just to the company

Section 7.4's Return/Dispose flow covers a staff member returning
something *to the company*. It doesn't cover the different case of
sending a faulty or wrong item *back to the supplier* for a refund,
replacement, or credit — its own workflow with a supplier-side
reference number (an RMA-style number) and an outcome (refunded /
replaced / credited / rejected) distinct from the internal return
reasons already covered.

### 8.10 Data export, not just import

Section 8.5 covers getting existing data *into* SIMS at go-live. The
reverse matters just as much on an ongoing basis: accountants,
auditors, or an insurer will periodically want a clean asset register
or spend report *out* of the system (CSV/Excel export), not just a
read-only screen they have to manually transcribe from.

### 8.11 Spend-based approval escalation

Section 7.2's approval flow is a flat single-approver model — one
person approves an equipment request or PO regardless of value. Larger
purchases often warrant a second sign-off (e.g. anything over a
configurable threshold needs director approval, not just a manager).
Worth a deliberate decision either way, rather than assuming a flat
approval chain covers every purchase size.

### 8.12 Linking Maintenance stock to a specific PMMS property

A concrete sharpening of the location question in 8.1: Maintenance
materials often belong to (or are stored at) a specific property, not
just held centrally or in a person's van — "this ladder lives at 12
Oak Street." SIMS should be able to reference a PMMS `property_id`
directly from a stock item or location record, using the exact
cross-schema query pattern already agreed in section 6, rather than
duplicating property data inside SIMS's own schema.

## 9. What's being asked of you

Please propose, at the concept/design level (not full implementation
yet):
1. An overall architecture and data model for the Stock & Inventory
   system across its 3 divisions, including how the IT
   division's serialised-equipment checkout/return flow (and the
   IT-specific features in section 7) differs from Maintenance/
   Office's simpler consumable tracking.
2. The core user flows: adding stock, requesting/allocating stock,
   low-stock alerts, IT equipment checkout/return, and which of
   section 7's features (POs, suppliers, maintenance schedules,
   depreciation, labels/QR) should be shared across all 3 divisions
   vs. IT-only, per the guidance given per-item above.
3. Exactly how division-based login/access and RLS should be
   structured in its own schema, consistent with section 4 above.
4. A concrete design for the cross-system data flows described in
   section 6 (schema/table shape for the "materials used on a PMMS
   job" link, and how a shared staff identity is referenced from the
   new schema).
5. A concrete resolution (or at minimum, a clearly stated recommended
   default plus tradeoffs) for each gap in section 8 — these are not
   optional to skip over silently.
6. Flag anywhere you think this brief is ambiguous or you'd want a
   human decision before locking in a design.
