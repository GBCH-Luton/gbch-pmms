import { COLORS } from '../../lib/colors'

// Walkthrough for the "locked job focus mode" workflow, built and live
// since 2026-08-11 -- started as a draft-proposal mockup reviewed with
// directors before anything was built, then updated in place once it
// shipped (and again for the post-launch gap fixes) rather than being
// replaced, so it stays one durable reference instead of a stale pitch
// deck sitting next to the real thing. Sits alongside the real
// Builder/Housekeeper guides under "Quick Guide" for the same reason those
// exist -- an easy walkthrough to point someone at.
//
// Served from public/builder-v2-guide.html, same recreated-mockup
// approach as builder-guide.html/housekeeping-guide.html, so it stays
// trivially printable/shareable on its own.
export default function AdminBuilderGuideV2() {
  return (
    <div style={{ maxWidth: '980px' }}>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Builder v.2 — Locked Job Focus Mode</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>
        Built and live since 2026-08-11 -- locks the app down to one job at a time to fix missed clock-ins/outs and after-the-fact job logging.
      </p>
      <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `1px solid ${COLORS.slate200}` }}>
        <iframe
          title="Builder Workflow v2 -- Locked Job Focus Mode"
          src="/builder-v2-guide.html"
          style={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: '600px', border: 0, display: 'block' }}
        />
      </div>
    </div>
  )
}
