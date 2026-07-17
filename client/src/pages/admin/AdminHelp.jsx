import { useState } from 'react'

// The system's runbook: plain-language answers to "how do I do X" and "what
// do I do if Y breaks", written for a non-technical admin. Keep every
// instruction here in sync with the real button/page names in the app --
// if a button gets renamed or moved, update the matching step here too.

const SECTIONS = [
  {
    icon: '🔑',
    title: 'Login & password help',
    body: [
      { q: "A staff member forgot their password or can't log in", a: 'Go to Admin > find their name in the Staff List > click "Reset password" > "Generate temp password". Tell them the temporary password directly (in person or by phone, not by email) -- they\'ll be forced to set their own password the moment they log in with it.' },
      { q: 'A new person is joining', a: 'Go to Admin > "+ Add Staff Member" > fill in their name, email, job title, and pick a Role (this is required -- it\'s what actually grants them access, not their job title). A temporary password is generated for you to give them the same way as above.' },
      { q: 'Someone is leaving the company', a: 'Go to Admin > find their name > click "Deactivate". This blocks their login immediately while keeping their history (past jobs, timesheets) intact. Don\'t delete their record -- deactivating is the correct way to remove access.' },
    ],
  },
  {
    icon: '🚦',
    title: 'Daily health check',
    body: [
      { q: 'Where do I get a quick read on how things are going?', a: 'The Dashboard page (the first thing you see after logging in). "P1 Critical" shows urgent tickets needing attention. "Pending Sign-Off" shows completed jobs waiting for your review before they\'re archived. "Flagged Locations" shows jobs where a builder clocked in/out somewhere unexpectedly far from the property -- worth a quick look, not necessarily a problem every time.' },
      { q: 'What are the "Compliance", "Void Aging" and "Gardens" tiles further down the Dashboard?', a: 'Each flags things that need attention before they become a real problem: certificates/inspections due to expire, rooms sitting empty too long, and gardens overdue a review. Click any tile to jump straight to the filtered list. These only show for Maintenance-facing staff -- a Housekeeping Manager\'s dashboard doesn\'t show them, since they\'re not relevant to that role (see "Divisions" below).' },
    ],
  },
  {
    icon: '🏠',
    title: 'Adding a new property',
    body: [
      { q: 'How do I add a property to the system?', a: 'Go to Properties > "+ Add Property" and fill in the details. Once added, any builder can raise a ticket against it, and it\'ll appear throughout Pipeline, Clocking, and Sign-Off automatically.' },
      { q: 'What are all the tabs on a property\'s profile for?', a: 'Core (photo, details, structure, access/safety notes, vulnerability flag, cleaner assignment), Compliance, Assets, Maintenance, Lease & Legal, Documents, Notes, Rooms, Restrictions (gender-matching for support workers/cleaners), and Gardens (see below). A Housekeeping Manager only sees Core and Restrictions -- everything else is Maintenance-manager territory.' },
    ],
  },
  {
    icon: '🧭',
    title: 'Divisions: why some managers see less than others',
    body: [
      { q: 'What is a "division"?', a: 'A division (e.g. "Maintenance" or "Housekeeping") scopes a manager role to only the tickets, staff, and dashboard content relevant to that side of the business. It\'s set per-role on the Admin page\'s Roles panel, not per-person. Most existing roles have no division set at all -- they\'re "unscoped" and see everything, exactly as this system always worked.' },
      { q: 'What does a division-scoped manager (e.g. a Housekeeping Manager) actually see differently?', a: 'Their own division\'s tickets, staff, and clocking records only -- Maintenance-only dashboard sections (Compliance, Void Aging, Gardens) and nav items (Compliance, Voids, Stock) are hidden entirely. Property profiles only show the Core and Restrictions tabs, both read-only except the cleaner assignment.' },
      { q: 'Does this affect builders too, not just managers?', a: 'Yes -- a builder in a division-scoped role (e.g. Housekeeper) only sees and can claim jobs in their own division from the Available Jobs queue. An ordinary Builder (no division set) still sees everything, unchanged.' },
    ],
  },
  {
    icon: '🎭',
    title: 'Roles and access, in plain terms',
    body: [
      { q: 'What does "Role" actually control?', a: 'A person\'s PMMS Role (set on the Admin page) decides what they can see and do in the system -- Admin sees and manages everything; Builder only sees their own assigned jobs. Their job title (e.g. "Maintenance Operative") is separate, company-wide information and does NOT by itself grant system access.' },
      { q: 'What are custom roles like "Maintenance Manager"?', a: 'You can create your own named roles on the Admin page\'s Roles panel and decide what level of access each one gets (No login / Manager access / Builder access), and optionally scope it to a division (see "Divisions" above). This lets you use whatever job titles make sense for your organisation without being limited to just "Admin" and "Builder".' },
    ],
  },
  {
    icon: '🧹',
    title: 'Cleaners Rota (Housekeeping)',
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
    icon: '🌱',
    title: 'Gardens',
    body: [
      { q: 'How do I start tracking a property\'s garden?', a: 'Open the property\'s Gardens tab and click "This property has a garden" -- it\'s off by default. Once on, you can set its state (Good / Needs Attention / Overgrown), the last-attended date and who did it, and upload the current front/back photos.' },
      { q: 'Does the "last attended" date update itself?', a: 'Only when a staff member completes a job raised under "Grounds & External Works" (Garden maintenance / Tree-hedge trimming / Grass cutting) -- the date and their name are stamped automatically. A contractor visit has no login, so someone needs to enter it by hand on the Gardens tab instead. The state and photos are always entered by hand either way.' },
      { q: 'How does the review reminder work?', a: 'Settings > Gardens has one shared "days since last attended" number for the whole portfolio -- change it by hand for the season (e.g. shorter in summer, longer in winter). The Dashboard\'s Gardens tile shows how many are Overdue / Due Soon / Recently Attended, and clicking it lists the actual properties.' },
    ],
  },
  {
    icon: '📋',
    title: 'Raising a ticket',
    body: [
      { q: 'What\'s the order of the Log a Ticket form?', a: 'Property > Room/Area > Main Category > the specific issue. Category options depend on which room/area you pick, so the right category (including "Grounds & External Works" for garden issues -- pick "Garden" as the area) only appears once that\'s chosen.' },
      { q: 'Someone outside PMMS (e.g. a support worker in a different system) wants to report an issue -- can they raise it themselves?', a: 'Not directly -- they have no login. Someone with PMMS access raises it on their behalf. There\'s currently no dedicated field to record who the original outside reporter was; if that matters, note it in the description for now.' },
    ],
  },
  {
    icon: '⚖',
    title: 'How priority scoring works',
    body: [
      { q: 'What decides if a ticket shows as "P1 Critical" or "P2 Urgent"?', a: 'Every category and specific issue (Settings > Maintenance Categories) carries a points score. A ticket\'s total score is compared against two thresholds (Settings > Priority Engine Thresholds) -- above the higher one it\'s P1 Critical, above the lower one it\'s P2 Urgent. A property flagged high-vulnerability adds extra points on top automatically.' },
      { q: 'Can I change what counts as urgent?', a: 'Yes -- both the per-issue scores and the two threshold numbers are editable in Settings, with no code changes needed. Changing a threshold re-classifies existing open tickets immediately, not just new ones.' },
    ],
  },
  {
    icon: '✅',
    title: 'Sign-Off',
    body: [
      { q: 'What is the Sign-Off page for?', a: 'Every completed job (repair, compliance check, or cleaning visit) waits here for a manager to review its note/photos (and checklist, for cleaning visits) before archiving it with "Verify & Archive". Nothing is auto-archived.' },
      { q: 'Can I filter by who raised the ticket?', a: 'Yes -- there\'s a "Raised By" filter on the Sign-Off page alongside the usual property/category filters.' },
    ],
  },
  {
    icon: '🕐',
    title: 'Clocking & mileage',
    body: [
      { q: 'How does clock-in/out location checking work?', a: 'When a builder clocks in or out, their device location is compared to the property\'s -- if it\'s further away than the configured distance (Settings > Clocking Rules), it\'s flagged and shows up on the Dashboard\'s "Flagged Locations" count and on the Clocking page.' },
      { q: 'Where do I see mileage?', a: 'The Clocking page shows fleet mileage; a builder can see their own on their "My Mileage" page.' },
    ],
  },
  {
    icon: '🔔',
    title: 'Alerts you can tune in Settings',
    body: [
      { q: 'What alerts exist, and where do I adjust them?', a: 'All in Settings: Stuck Ticket Alerts (how long before an open ticket is flagged, scaled by priority), Compliance Alerts (days before a certificate/inspection expiry counts as due-soon), Void Aging Alerts (days a room can sit empty before it\'s overdue), Routine Cleaning Visits and Gardens (both described above), and the On-Call Roster (who gets notified when a P1 Critical ticket is raised).' },
    ],
  },
  {
    icon: '🛠',
    title: "If something looks broken",
    body: [
      { q: 'A page looks wrong or a button doesn\'t seem to do anything', a: 'First, try refreshing the page. If that doesn\'t help, sign out and log back in. Check whether it\'s happening to just one person or everyone -- that\'s useful information to pass along if you need help fixing it.' },
      { q: 'I see a red error message after clicking something', a: 'These messages (added deliberately) tell you plainly what went wrong instead of failing silently. Note down the exact wording and what you were doing -- that\'s exactly what\'s needed to track down and fix the underlying problem.' },
    ],
  },
  {
    icon: '🚀',
    title: 'Before this system goes live',
    body: [
      { q: 'Is everything we\'ve built ready for real, live use?', a: 'Almost, with one important catch: this app can run against two different databases -- a "sandbox" (testing) one and a separate default one. All of the security work done so far (requiring login, restricting Builders to only their own data, division scoping, etc.) has only been applied to the sandbox database. Before any real staff member logs in for real, whichever database becomes the permanent one needs the exact same security work applied to it -- ask your developer/assistant to confirm this explicitly before go-live, don\'t assume it carried over automatically.' },
    ],
  },
]

function HelpSection({ section, isOpen, onToggle }) {
  return (
    <div style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
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
  const [openKey, setOpenKey] = useState(SECTIONS[0].title)

  return (
    <div>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Help & Guide</h1>
      <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
        Plain-language answers for the day-to-day admin tasks and questions that come up running this system.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {SECTIONS.map(section => (
          <HelpSection
            key={section.title}
            section={section}
            isOpen={openKey === section.title}
            onToggle={() => setOpenKey(openKey === section.title ? null : section.title)}
          />
        ))}
      </div>
    </div>
  )
}
