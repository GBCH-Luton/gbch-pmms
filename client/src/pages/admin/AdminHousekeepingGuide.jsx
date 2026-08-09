import { COLORS } from '../../lib/colors'

// Shows admin/manager a read-only walkthrough of the whole Housekeeping
// division -- setup, the Housekeeping Manager's dashboard, and what a
// Housekeeper sees on their phone -- same "Quick Guide" treatment as the
// Builder App Guide it sits alongside (see AdminBuilderGuide.jsx).
//
// Served from public/housekeeping-guide.html (a standalone static page,
// same recreated-mockup approach as builder-guide.html) rather than
// reimplemented as JSX, so it stays trivially printable/shareable on its
// own, independent of the app shell around it here.
export default function AdminHousekeepingGuide() {
  return (
    <div style={{ maxWidth: '980px' }}>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Housekeeping Division Guide</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>
        How the Housekeeping division works, A to Z -- setup, the manager's dashboard, and a Housekeeper's phone, step by step.
      </p>
      <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `1px solid ${COLORS.slate200}` }}>
        <iframe
          title="Housekeeping Division Guide"
          src="/housekeeping-guide.html"
          style={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: '600px', border: 0, display: 'block' }}
        />
      </div>
    </div>
  )
}
