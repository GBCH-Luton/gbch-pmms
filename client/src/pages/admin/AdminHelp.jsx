import { useState, useMemo } from 'react'

// The system's runbook: plain-language answers to "how do I do X" and "what
// do I do if Y breaks", written for a non-technical admin. Keep every
// instruction here in sync with the real button/page names in the app --
// if a button gets renamed or moved, update the matching step here too.
//
// Organised one section per nav page (in nav order), plus a couple of
// cross-cutting concept sections (Divisions, Priority Scoring) that touch
// several pages at once and would otherwise get repeated everywhere. Each
// section is tagged `division: 'All' | 'Maintenance' | 'Housekeeping'` so
// the division filter below can hide what's not relevant to the reader --
// most sections are 'All' since only a handful of pages are actually
// division-gated in the app itself.
//
// A few sections (Pipeline, Compliance, Voids, Stock, Reports) are still
// short placeholders -- flesh these out the same way the others were done,
// one at a time, rather than leaving this comment as a permanent excuse.

const SECTIONS = [
  {
    key: 'login',
    icon: '🔑',
    title: 'Login & Access',
    division: 'All',
    body: [
      { q: 'How does signing in work?', a: 'The login screen just asks for a work email and password (Sign in to your account). There\'s no self-service "Forgotten password" link by design -- the screen itself says "Forgotten your password? Contact your manager or admin."' },
      { q: 'What happens the first time a new starter logs in?', a: 'They sign in with the temporary password you gave them, and are immediately taken to a forced "Set a new password" screen -- they cannot access anything else in the system until they set their own (at least 6 characters, entered twice to confirm). This is the must_reset_password flag being cleared automatically the moment they finish.' },
      { q: 'What if someone forgets their password later?', a: 'Same mechanism as onboarding: Admin > find their name > "Reset password" > "Generate temp password". Give them the temporary password directly (in person or by phone, not email). Logging in with it immediately puts them back on the forced "Set a new password" screen -- they\'re never left using the temporary one.' },
      { q: 'What actually happens when someone is "Deactivated"?', a: 'Their account itself isn\'t deleted -- deactivating just flips a switch (their `active` flag) that blocks them at the app level. If they still try to log in with their old password, they land on a plain "account deactivated" screen with no access to anything, while their history (past jobs, timesheets, audit trail) stays fully intact underneath. This is why deactivating, not deleting, is always the right way to remove someone\'s access.' },
      { q: 'What actually decides whether I land on the Admin view or the Builder (job list) view after logging in?', a: 'Their PMMS Role, not their job title. A Role with Admin or Manager-level access lands on the dashboard/nav experience described throughout this guide; a Role with Builder-level access lands on the simpler mobile-style job list instead. See "Admin: Staff Accounts & Roles" below for exactly how a Role is assigned.' },
      { q: 'Is there any record of who logged in and when?', a: 'Yes -- the Admin page has a "Recent Login Activity" panel showing recent sign-ins across the company, each with a name, email, and timestamp. There\'s no need to ask someone whether they\'ve logged in yet -- it\'s right there.' },
    ],
  },
  {
    key: 'dashboard',
    icon: '🚦',
    title: 'Dashboard',
    division: 'All',
    body: [
      { q: 'Where do I get a quick read on how things are going?', a: 'The Dashboard page (the first thing you see after logging in). "P1 Critical" shows urgent tickets needing attention. "Pending Sign-Off" shows completed jobs waiting for your review before they\'re archived. "Flagged Locations" shows jobs where a builder clocked in/out somewhere unexpectedly far from the property -- worth a quick look, not necessarily a problem every time.' },
      { q: 'What are the "Compliance", "Void Aging" and "Gardens" tiles further down the Dashboard?', a: 'Each flags things that need attention before they become a real problem: certificates/inspections due to expire, rooms sitting empty too long, and gardens overdue a review. Click any tile to jump straight to the filtered list. These only show for Maintenance-facing staff -- a Housekeeping Manager\'s dashboard doesn\'t show them, since they\'re not relevant to that role (see "Understanding Divisions" below).', },
      { q: 'Every KPI tile seems clickable -- where do they go?', a: 'Every tile on the Dashboard links straight to the relevant page, already filtered (e.g. clicking "P1 Critical" opens Pipeline pre-filtered to critical tickets). It\'s meant to be a jumping-off point, not just a read-only summary.' },
    ],
  },
  {
    key: 'pipeline',
    icon: '🧰',
    title: 'Pipeline',
    division: 'Maintenance',
    body: [
      { q: 'What is the Pipeline page for?', a: 'The main console for managing every ticket in the system -- a filterable, sortable table with an expandable detail view per row. It\'s where you go when the Dashboard tells you something needs attention and you need to actually find and act on it.' },
      { q: 'What do the KPI tiles at the top do?', a: '"Total tickets", "Unassigned", "In Progress", "On Hold", "Completed", "P1 Critical", and "Stuck" each double as a one-click filter -- click a tile to instantly filter the table to just that group.' },
      { q: 'What other filters are available?', a: 'Status, property, a ticket-number search box, category, builder, priority, and a "Stuck only" checkbox -- all combinable at once.' },
      { q: 'What can I do from an expanded row?', a: 'Comments, History (the full audit trail for that ticket), Priority (override the calculated score), Cancel, and Reassign. Select multiple rows\' checkboxes to use Bulk Reassign across several tickets at once.' },
    ],
  },
  {
    key: 'properties',
    icon: '🏠',
    title: 'Properties',
    division: 'All',
    body: [
      { q: 'How do I add a property to the system?', a: 'Go to Properties > "+ Add Property" and fill in the details. Once added, any builder can raise a ticket against it, and it\'ll appear throughout Pipeline, Clocking, and Sign-Off automatically.' },
      { q: 'What are all the tabs on a property\'s profile for?', a: 'Core (photo, details, structure, access/safety notes, vulnerability flag, cleaner assignment), Compliance, Assets, Maintenance, Lease & Legal, Documents, Notes, Rooms, Restrictions (gender-matching for support workers/cleaners), and Gardens (see below). A Housekeeping Manager only sees Core and Restrictions -- everything else is Maintenance-manager territory.' },
    ],
  },
  {
    key: 'compliance',
    icon: '📄',
    title: 'Compliance',
    division: 'Maintenance',
    body: [
      { q: 'What is the Compliance page for?', a: 'A portfolio-wide, read-only rollup of every property\'s certificate/inspection status (gas safety, EICR, etc.) -- one row per property-and-certificate-type combination, each with a status pill (Expired/Due Soon/No Record/Valid) and an expiry countdown. Clicking a row jumps straight into that property\'s own Compliance tab, which is where the actual record gets updated.' },
      { q: 'What filters are available?', a: 'The KPI tiles ("Total records", "Expired", "Due Soon", "No Record", "Valid") act as one-click filters, plus dropdowns for status, certificate type ("All Cert Types"), and a property search box.' },
      { q: 'Where do I change the due-soon/expired thresholds?', a: 'Settings > Compliance Alerts -- how many days before an actual expiry a record counts as "due soon" portfolio-wide.' },
    ],
  },
  {
    key: 'voids',
    icon: '🔲',
    title: 'Voids',
    division: 'Maintenance',
    body: [
      { q: 'What is the Voids page for?', a: 'A portfolio-wide, read-only view of every currently-void (empty) room and how long each has sat that way, so turnaround stays on top of it. Clicking a row jumps into that property\'s Rooms tab, which is where the actual status gets changed.' },
      { q: 'What do the KPI tiles show?', a: '"Total Void", "Overdue", "Aging", and "Recent" -- each also acts as a one-click filter by aging tier. A separate "Voided Recently" strip shows turnover velocity: "Voided Today", "Voided This Week", "Voided This Month".' },
      { q: 'What columns does the table show?', a: 'Property, Room, Room Type, Bed Type, Status, Void Since, and Days Void -- fully sortable.' },
      { q: 'Where do I change the overdue threshold?', a: 'Settings > Void Aging Alerts -- how many days a room can sit void before it counts as overdue portfolio-wide.' },
    ],
  },
  {
    key: 'sign-off',
    icon: '✅',
    title: 'Sign-Off',
    division: 'All',
    body: [
      { q: 'What is the Sign-Off page for?', a: 'Every completed job (repair, compliance check, or cleaning visit) waits here for a manager to review its note/photos (and checklist, for cleaning visits) before archiving it with "Verify & Archive". Nothing is auto-archived.' },
      { q: 'Can I filter by who raised the ticket?', a: 'Yes -- there\'s a "Raised By" filter on the Sign-Off page alongside the usual property/category filters.' },
    ],
  },
  {
    key: 'housekeeping',
    icon: '🧹',
    title: 'Housekeeping (Cleaners Rota)',
    division: 'Housekeeping',
    body: [
      { q: 'How does a property get a regular cleaner?', a: 'Open the property\'s Core tab > "Assigned Cleaner" > "Assign" (or "Reassign" if it already has one). Only cleaners matching the property\'s gender restriction, if it has one (Restrictions tab), are offered.' },
      { q: 'How do routine visits get scheduled?', a: 'They don\'t need to be -- the system automatically creates a routine visit job on the cleaner\'s own job list once a property passes its configured threshold since the last visit (Settings > Routine Cleaning Visits, default 12 days).' },
      { q: 'A cleaner couldn\'t make a visit on time -- what happens?', a: 'They tap "Can\'t do this on time? Report a delay" and pick a reason. The job doesn\'t close or change status -- it just waits for a manager to approve or reject the reason from the Housekeeping page\'s "Pending Delay Reasons" section.' },
      { q: 'What stops a routine visit being marked done without actually being done?', a: 'A checklist (Settings > Routine Visit Checklist) -- every item must be ticked before the "Confirm" button on the completion screen becomes active. Photos and a note are captured on top of that, not instead of it.' },
      { q: 'Where does a manager see the whole picture?', a: 'The Housekeeping page: "Routine Visits Due" (Overdue/Due Soon/OK), "Cleaner Workload" (who\'s carrying what), and "Pending Delay Reasons". Only visible to Housekeeping-division roles and Admin.' },
      { q: 'How does an urgent clean get raised?', a: 'Same as any repair -- Log a Ticket > pick the property > category "Cleaning Rota" > "Urgent Clean". Only Housekeeping staff are offered when assigning it.' },
    ],
  },
  {
    key: 'gardens',
    icon: '🌱',
    title: 'Gardens',
    division: 'Maintenance',
    body: [
      { q: 'How do I start tracking a property\'s garden?', a: 'Open the property\'s Gardens tab and click "This property has a garden" -- it\'s off by default. Once on, you can set its state (Good / Needs Attention / Overgrown), the last-attended date and who did it, and upload the current front/back photos.' },
      { q: 'Does the "last attended" date update itself?', a: 'Only when a staff member completes a job raised under "Grounds & External Works" (Garden maintenance / Tree-hedge trimming / Grass cutting) -- the date and their name are stamped automatically. A contractor visit has no login, so someone needs to enter it by hand on the Gardens tab instead. The state and photos are always entered by hand either way.' },
      { q: 'How does the review reminder work?', a: 'Settings > Gardens has one shared "days since last attended" number for the whole portfolio -- change it by hand for the season (e.g. shorter in summer, longer in winter). The Dashboard\'s Gardens tile shows how many are Overdue / Due Soon / Recently Attended, and clicking it lists the actual properties.' },
    ],
  },
  {
    key: 'staff',
    icon: '👷',
    title: 'Staff (Live Field Radar)',
    division: 'All',
    body: [
      { q: 'What is the Staff page for, versus the Admin page?', a: 'Staff is day-to-day monitoring -- KPI tiles and a "Live Field Radar" table showing every relevant staff member\'s current Duty Status (On-Site Active, Available, On Leave, Sick, etc.) and current assignment, filterable by role. Adding, editing, deactivating accounts, and managing Roles all live on the separate Admin page instead -- Staff doesn\'t offer any way to change someone\'s access.' },
      { q: 'Can I mark someone as on leave or sick from here?', a: 'Yes -- their availability (Available / On Leave / Sick) is set directly on this page and immediately affects their Duty Status shown to everyone else.' },
      { q: 'Can I open someone\'s full history from here?', a: 'Yes -- clicking a staff member opens their full profile page (past jobs, mileage, etc.).' },
    ],
  },
  {
    key: 'clocking',
    icon: '🕐',
    title: 'Clocking & Mileage',
    division: 'All',
    body: [
      { q: 'How does clock-in/out location checking work?', a: 'When a builder clocks in or out, their device location is compared to the property\'s -- if it\'s further away than the configured distance (Settings > Clocking Rules), it\'s flagged and shows up on the Dashboard\'s "Flagged Locations" count and on the Clocking page.' },
      { q: 'Where do I see mileage?', a: 'The Clocking page shows fleet mileage; a builder can see their own on their "My Mileage" page.' },
    ],
  },
  {
    key: 'raise-ticket',
    icon: '📋',
    title: 'Log a Ticket',
    division: 'All',
    body: [
      { q: 'What\'s the order of the Log a Ticket form?', a: 'Property > Room/Area > Main Category > the specific issue. Category options depend on which room/area you pick, so the right category (including "Grounds & External Works" for garden issues -- pick "Garden" as the area) only appears once that\'s chosen.' },
      { q: 'Someone outside PMMS (e.g. a support worker in a different system) wants to report an issue -- can they raise it themselves?', a: 'Not directly -- they have no login. Someone with PMMS access raises it on their behalf. There\'s currently no dedicated field to record who the original outside reporter was; if that matters, note it in the description for now.' },
    ],
  },
  {
    key: 'stock',
    icon: '📦',
    title: 'Stock',
    division: 'Maintenance',
    body: [
      { q: 'What is the Stock page for?', a: 'A "Coming Soon" placeholder for now -- the intention is to eventually show maintenance stock and appliances (fridges, stoves, kettles, bathtubs, and similar property fittings) available to builders, once it\'s linked to the company\'s own central stock management system. Stock/inventory is deliberately planned to live in that separate standalone system rather than being built inside PMMS itself, so don\'t expect day-to-day inventory tracking here yet.' },
    ],
  },
  {
    key: 'reports',
    icon: '📊',
    title: 'Reports',
    division: 'All',
    body: [
      { q: 'What is the Reports page for?', a: 'Portfolio-wide historical and trend reporting, built entirely from existing ticket data over a date range you choose -- a wider, slower-moving view than Pipeline\'s day-to-day working list.' },
      { q: 'What filters and KPIs does it show?', a: '"From"/"To" date pickers, plus "All Categories" and "All Staff" dropdowns. KPI tiles: "Tickets Raised (Range)", "Completed (Range)", "Currently Open", "Avg. Turnaround", and "Avg. Response Time".' },
      { q: 'What charts and tables are on this page?', a: '"Tickets Raised vs. Completed (by week)" and "Tickets by Category" (toggle to "By Division"); further down, "Properties With the Most Tickets" (flags "⚠ Recurring" once a property hits 3+ tickets in the range) and a "Staff Workload (Range)" table.' },
    ],
  },
  {
    key: 'settings',
    icon: '🔔',
    title: 'Settings (alerts & configuration)',
    division: 'All',
    body: [
      { q: 'What alerts and thresholds live in Settings?', a: 'Priority Engine Thresholds (P1/P2 cutoffs), Maintenance Categories (every category, sub-category, and its points score), Compliance Check Types, Clocking Rules (overrun warning, clock-in/out distance check), Stuck Ticket Alerts, Compliance Alerts, Void Aging Alerts, Routine Cleaning Visits, Gardens, Routine Visit Checklist, On-Call Roster (who\'s notified for a P1 Critical), and Dashboard Metrics.' },
      { q: 'Do changes here take effect immediately?', a: 'Yes -- these all read live from the database, not hardcoded values. Changing a threshold, score, or category re-classifies/affects existing tickets immediately, not just new ones going forward.' },
    ],
  },
  {
    key: 'admin',
    icon: '🎭',
    title: 'Admin: Staff Accounts & Roles',
    division: 'All',
    body: [
      { q: 'What does "Role" actually control?', a: 'A person\'s PMMS Role (set here, on the Admin page) decides what they can see and do in the system -- Admin sees and manages everything; Builder only sees their own assigned jobs. Their job title (e.g. "Maintenance Operative") is separate, company-wide information and does NOT by itself grant system access.' },
      { q: 'What are custom roles like "Maintenance Manager"?', a: 'You can create your own named roles on the Roles panel and decide what level of access each one gets (No login / Manager access / Builder access), and optionally scope it to a division (see "Understanding Divisions" below). This lets you use whatever job titles make sense for your organisation without being limited to just "Admin" and "Builder".' },
      { q: 'A staff member forgot their password or can\'t log in', a: 'Find their name in the Staff List > click "Reset password" > "Generate temp password". Tell them the temporary password directly (in person or by phone, not by email) -- they\'ll be forced to set their own password the moment they log in with it.' },
      { q: 'A new person is joining', a: '"+ Add Staff Member" > fill in their name, email, job title, and pick a Role (this is required -- it\'s what actually grants them access, not their job title). A temporary password is generated for you to give them the same way as above.' },
      { q: 'Someone is leaving the company', a: 'Find their name > click "Deactivate". This blocks their login immediately while keeping their history (past jobs, timesheets) intact. Don\'t delete their record -- deactivating is the correct way to remove access.' },
      { q: 'This page is Admin-only -- why can\'t a manager see it?', a: 'Deliberately -- creating/deactivating accounts and granting access is kept separate from day-to-day management, which is why staff monitoring lives on the separate Staff page instead, open to managers too.' },
    ],
  },
  {
    key: 'divisions-explained',
    icon: '🧭',
    title: 'Understanding Divisions',
    division: 'All',
    body: [
      { q: 'What is a "division"?', a: 'A division (e.g. "Maintenance" or "Housekeeping") scopes a manager or builder role to only the tickets, staff, and content relevant to that side of the business. It\'s set per-role on the Admin page\'s Roles panel, not per-person. Most existing roles have no division set at all -- they\'re "unscoped" and see everything, exactly as this system always worked.' },
      { q: 'What does a division-scoped manager (e.g. a Housekeeping Manager) actually see differently?', a: 'Their own division\'s tickets, staff, and clocking records only -- Maintenance-only dashboard sections (Compliance, Void Aging, Gardens) and nav items (Compliance, Voids, Stock) are hidden entirely. Property profiles only show the Core and Restrictions tabs, both read-only except the cleaner assignment.' },
      { q: 'Does this affect builders too, not just managers?', a: 'Yes -- a builder in a division-scoped role (e.g. Housekeeper) only sees and can claim jobs in their own division from the Available Jobs queue. An ordinary Builder (no division set) still sees everything, unchanged.' },
    ],
  },
  {
    key: 'priority-scoring',
    icon: '⚖',
    title: 'How Priority Scoring Works',
    division: 'All',
    body: [
      { q: 'What decides if a ticket shows as "P1 Critical" or "P2 Urgent"?', a: 'Every category and specific issue (Settings > Maintenance Categories) carries a points score. A ticket\'s total score is compared against two thresholds (Settings > Priority Engine Thresholds) -- above the higher one it\'s P1 Critical, above the lower one it\'s P2 Urgent. A property flagged high-vulnerability adds extra points on top automatically.' },
      { q: 'Can I change what counts as urgent?', a: 'Yes -- both the per-issue scores and the two threshold numbers are editable in Settings, with no code changes needed. Changing a threshold re-classifies existing open tickets immediately, not just new ones.' },
    ],
  },
  {
    key: 'troubleshooting',
    icon: '🛠',
    title: 'If Something Looks Broken',
    division: 'All',
    body: [
      { q: 'A page looks wrong or a button doesn\'t seem to do anything', a: 'First, try refreshing the page. If that doesn\'t help, sign out and log back in. Check whether it\'s happening to just one person or everyone -- that\'s useful information to pass along if you need help fixing it.' },
      { q: 'I see a red error message after clicking something', a: 'These messages (added deliberately) tell you plainly what went wrong instead of failing silently. Note down the exact wording and what you were doing -- that\'s exactly what\'s needed to track down and fix the underlying problem.' },
    ],
  },
  {
    key: 'go-live',
    icon: '🚀',
    title: 'Before This System Goes Live',
    division: 'All',
    body: [
      { q: 'Is everything we\'ve built ready for real, live use?', a: 'Almost, with one important catch: this app can run against two different databases -- a "sandbox" (testing) one and a separate default one. All of the security work done so far (requiring login, restricting Builders to only their own data, division scoping, etc.) has only been applied to the sandbox database. Before any real staff member logs in for real, whichever database becomes the permanent one needs the exact same security work applied to it -- ask your developer/assistant to confirm this explicitly before go-live, don\'t assume it carried over automatically.' },
    ],
  },
]

const inputStyle = { padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

function sectionMatchesSearch(section, query) {
  const q = query.toLowerCase()
  if (section.title.toLowerCase().includes(q)) return true
  return section.body.some(item => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q))
}

function HelpSection({ section, isOpen, onToggle }) {
  return (
    <div id={`help-section-${section.key}`} style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden', scrollMarginTop: '16px' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px',
          background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '20px' }}>{section.icon}</span>
        <span style={{ flex: 1, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{section.title}</span>
        <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 700 }}>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div style={{ padding: '0 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {section.body.map((item, i) => (
            <div key={i} style={{ borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{item.q}</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>{item.a}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AdminHelp() {
  const [openKey, setOpenKey] = useState(SECTIONS[0].key)
  const [search, setSearch] = useState('')
  const [divisionFilter, setDivisionFilter] = useState('All')

  const trimmedSearch = search.trim()
  const isSearching = trimmedSearch.length > 0

  const visibleSections = useMemo(() => {
    return SECTIONS.filter(s => {
      if (divisionFilter !== 'All' && s.division !== 'All' && s.division !== divisionFilter) return false
      if (isSearching && !sectionMatchesSearch(s, trimmedSearch)) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionFilter, trimmedSearch])

  function handleJumpTo(key) {
    if (!key) return
    setOpenKey(key)
    setSearch('')
    setTimeout(() => {
      document.getElementById(`help-section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Help & Guide</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
        One section per page in the system -- read a section to understand how that whole page works, not just answers to isolated questions.
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Search the guide..."
          style={{ ...inputStyle, flex: '2 1 240px' }}
        />
        <select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)} style={{ ...inputStyle, flex: '1 1 170px', cursor: 'pointer' }}>
          <option value="All">All divisions</option>
          <option value="Maintenance">Maintenance only</option>
          <option value="Housekeeping">Housekeeping only</option>
        </select>
        <select value="" onChange={(e) => handleJumpTo(e.target.value)} style={{ ...inputStyle, flex: '1 1 170px', cursor: 'pointer' }}>
          <option value="">Jump to section...</option>
          {SECTIONS.map(s => <option key={s.key} value={s.key}>{s.icon} {s.title}</option>)}
        </select>
      </div>

      {visibleSections.length === 0 ? (
        <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Nothing matches "{trimmedSearch}".</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {visibleSections.map(section => (
            <HelpSection
              key={section.key}
              section={section}
              isOpen={isSearching ? true : openKey === section.key}
              onToggle={() => setOpenKey(openKey === section.key ? null : section.key)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
