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
    ],
  },
  {
    icon: '🏠',
    title: 'Adding a new property',
    body: [
      { q: 'How do I add a property to the system?', a: 'Go to Properties > "+ Add Property" and fill in the details. Once added, any builder can raise a ticket against it, and it\'ll appear throughout Pipeline, Clocking, and Sign-Off automatically.' },
    ],
  },
  {
    icon: '🎭',
    title: 'Roles and access, in plain terms',
    body: [
      { q: 'What does "Role" actually control?', a: 'A person\'s PMMS Role (set on the Admin page) decides what they can see and do in the system -- Admin sees and manages everything; Builder only sees their own assigned jobs. Their job title (e.g. "Maintenance Operative") is separate, company-wide information and does NOT by itself grant system access.' },
      { q: 'What are custom roles like "Maintenance Manager"?', a: 'You can create your own named roles on the Admin page\'s Roles panel and decide what level of access each one gets (No login / Manager access / Builder access). This lets you use whatever job titles make sense for your organisation without being limited to just "Admin" and "Builder".' },
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
      { q: 'Is everything we\'ve built ready for real, live use?', a: 'Almost, with one important catch: this app can run against two different databases -- a "sandbox" (testing) one and a separate default one. All of the security work done so far (requiring login, restricting Builders to only their own data, etc.) has only been applied to the sandbox database. Before any real staff member logs in for real, whichever database becomes the permanent one needs the exact same security work applied to it -- ask your developer/assistant to confirm this explicitly before go-live, don\'t assume it carried over automatically.' },
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
