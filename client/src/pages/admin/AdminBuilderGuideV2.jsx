import { COLORS } from '../../lib/colors'

// Draft-proposal walkthrough for the "locked job focus mode" workflow
// change under discussion -- NOT a description of how PMMS actually
// behaves today (see the draft ribbon on the page itself). Sits alongside
// the real Builder/Housekeeper guides under "Quick Guide" purely so it's
// easy to pull up in front of the person reviewing it; nothing here is
// wired into the live builder app.
//
// Served from public/builder-v2-guide.html, same recreated-mockup
// approach as builder-guide.html/housekeeping-guide.html, so it stays
// trivially printable/shareable on its own.
export default function AdminBuilderGuideV2() {
  return (
    <div style={{ maxWidth: '980px' }}>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Builder v.2 — Draft Proposal</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>
        Locked job focus mode -- a proposal to fix missed clock-ins/outs and after-the-fact job logging. Not yet built.
      </p>
      <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `1px solid ${COLORS.slate200}` }}>
        <iframe
          title="Builder Workflow v2 -- Draft Proposal"
          src="/builder-v2-guide.html"
          style={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: '600px', border: 0, display: 'block' }}
        />
      </div>
    </div>
  )
}
