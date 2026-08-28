import { COLORS } from '../../lib/colors'

// Click-through copy of the real Start Travel -> Arrived -> Finished Visit
// flow on the Clocking page, plus a live preview of how each phase shows up
// on Where's the Team. Started as a disposable design simulation iterated
// with the user before the travel/on-site state machine shipped 2026-08-17
// for the Landlord Liaison Manager specifically, then kept and added here
// for training/onboarding -- same convention as the Builder guides
// alongside it. Extended to every manager-tier role 2026-08-28.
//
// Served from public/log-a-visit-guide.html, same recreated-mockup
// approach as the other guide pages, so it stays trivially printable/
// shareable on its own.
export default function AdminLogAVisitGuide() {
  return (
    <div style={{ maxWidth: '980px' }}>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Log a Visit — Manager Clocking</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>
        Built for Landlord Liaison 2026-08-17, extended to every manager-tier role 2026-08-28 -- Start Travel, Arrived, Finished Visit, then a required next-step pick (office, lunch, another property, or done for now).
      </p>
      <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `1px solid ${COLORS.slate200}` }}>
        <iframe
          title="Log a Visit Simulator"
          src="/log-a-visit-guide.html"
          style={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: '600px', border: 0, display: 'block' }}
        />
      </div>
    </div>
  )
}
