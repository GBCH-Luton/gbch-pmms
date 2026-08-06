import { COLORS } from '../../lib/colors'

// Shows admin/manager a read-only walkthrough of what a builder actually
// sees on their phone (clock in for the day -> jobs -> leaving site/away ->
// clock out), so a manager can understand the builder-facing side of the
// app without needing a device in hand. Deliberately builder-only content --
// the manager-facing half of this guide isn't needed here since the reader
// already has that side of the app open right next to it.
//
// Served from public/builder-guide.html (a standalone static page, same
// recreated-mockup approach as docs/Daily_Attendance_Guide.html) rather
// than reimplemented as JSX, so it stays trivially printable/shareable on
// its own (e.g. emailing the direct link to a builder) independent of the
// app shell around it here.
export default function AdminBuilderGuide() {
  return (
    <div style={{ maxWidth: '980px' }}>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Builder App Guide</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>
        What a builder sees on their phone, step by step -- clocking in for the day through to clocking out.
      </p>
      <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `1px solid ${COLORS.slate200}` }}>
        <iframe
          title="Builder App Guide"
          src="/builder-guide.html"
          style={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: '600px', border: 0, display: 'block' }}
        />
      </div>
    </div>
  )
}
