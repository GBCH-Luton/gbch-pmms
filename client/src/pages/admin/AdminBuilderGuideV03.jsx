import { COLORS } from '../../lib/colors'

// Interactive walkthrough of the "Leaving Site" redesign shipped 2026-08-15
// (big Leaving Site button, real page navigation instead of popovers,
// mileage-only arrival, Resume Jobs). Started as a disposable design
// simulation iterated with the directors before anything was built, then
// kept and updated in place once it shipped -- same convention as the
// Builder v.2 guide alongside it.
//
// Served from public/builder-v0.3-guide.html, same recreated-mockup
// approach as builder-v2-guide.html/builder-guide.html, so it stays
// trivially printable/shareable on its own.
export default function AdminBuilderGuideV03() {
  return (
    <div style={{ maxWidth: '980px' }}>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Builder v0.3 — Leaving Site Redesign</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>
        Built and live since 2026-08-15 -- a big unmissable Leaving Site button, real pages instead of popovers, mileage-only job arrivals, and Resume Jobs for paused work.
      </p>
      <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: `1px solid ${COLORS.slate200}` }}>
        <iframe
          title="Builder Workflow v0.3 -- Leaving Site Redesign"
          src="/builder-v0.3-guide.html"
          style={{ width: '100%', height: 'calc(100vh - 220px)', minHeight: '600px', border: 0, display: 'block' }}
        />
      </div>
    </div>
  )
}
