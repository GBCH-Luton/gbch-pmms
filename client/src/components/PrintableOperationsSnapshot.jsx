import { formatUKDateTime } from '../pages/admin/shared'
import { COLORS } from '../lib/colors'
import SimpleBarChart from './SimpleBarChart'

// A real, permanent, board-ready report -- deterministic from live data,
// no AI involved. Built after a director asked for "something visual" and
// the Claude Q&A box on this same page turned out to only return text.
// Visually matches the artifact mockup that was approved first (navy
// gradient hero, colour-coded pipeline bars, a compliance donut) rather
// than the plainer first pass -- see conversation this came out of. Same
// ".pmms-no-print"/".pmms-print-area" pattern as every other Printable*
// component (see PrintableAttendanceReport.jsx).
export default function PrintableOperationsSnapshot({ summary, onClose }) {
  const generatedAt = new Date()
  const complianceTotal = summary.complianceValid + summary.complianceDueSoon + summary.complianceExpired
  const compliancePct = complianceTotal > 0 ? Math.round((summary.complianceValid / complianceTotal) * 100) : null
  const maxPipeline = Math.max(1, ...summary.pipelineBars.map(b => b.count))

  const kpis = [
    ['Raised', summary.raisedCount],
    ['Completed', summary.completedCount],
    ['Currently Open', summary.currentlyOpenCount],
    ['Properties Managed', summary.totalProperties],
  ]

  // 3 stacked arcs (valid/due-soon/expired) around one donut ring --
  // stroke-dasharray/-dashoffset is the standard trick for turning a plain
  // SVG circle into a partial, offset arc.
  const R = 52
  const circumference = 2 * Math.PI * R
  function arc(value, offsetValue) {
    const length = complianceTotal > 0 ? (value / complianceTotal) * circumference : 0
    return { strokeDasharray: `${length} ${circumference}`, strokeDashoffset: complianceTotal > 0 ? -((offsetValue / complianceTotal) * circumference) : 0 }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: COLORS.white, overflowY: 'auto' }}>
      <div className="pmms-no-print" style={{
        position: 'sticky', top: 0, background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}`,
        padding: '12px 20px', display: 'flex', gap: '10px', justifyContent: 'flex-end', zIndex: 1,
      }}>
        <button onClick={() => window.print()} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: COLORS.slate900, color: COLORS.white, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Print / Save as PDF
        </button>
        <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Close
        </button>
      </div>

      <div className="pmms-print-area" style={{ padding: '32px', maxWidth: '820px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ background: `linear-gradient(135deg, ${COLORS.brandNavy} 0%, ${COLORS.brandNavyLight} 100%)`, borderRadius: '16px', padding: '28px 26px', marginBottom: '24px' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>GBCH · Property Maintenance Management</p>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: 800, color: COLORS.white }}>Operations Snapshot</h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.75)' }}>
            {summary.periodLabel}: <strong>{summary.rangeLabel}</strong> — generated {formatUKDateTime(generatedAt.toISOString())} UK, a point-in-time read, not a live feed.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {kpis.map(([label, value]) => (
            <div key={label} style={{ background: COLORS.slate50, borderRadius: '12px', padding: '14px', borderTop: `3px solid ${COLORS.teal600}` }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
              <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: COLORS.slate900 }}>{value}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          <div>
            <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Ticket Pipeline</p>
            <p style={{ margin: '0 0 12px 0', fontSize: '11.5px', color: COLORS.slate500 }}>Live, as of right now.</p>
            <div>
              {summary.pipelineBars.map(b => (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '9px' }}>
                  <span style={{ width: '84px', flexShrink: 0, fontSize: '12px', fontWeight: 700, color: COLORS.slate900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</span>
                  <span style={{ flex: 1, background: COLORS.slate100, borderRadius: '6px', height: '16px', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', borderRadius: '6px', width: `${(b.count / maxPipeline) * 100}%`, background: b.colour }} />
                  </span>
                  <span style={{ width: '22px', flexShrink: 0, textAlign: 'right', fontSize: '12px', fontWeight: 800, color: COLORS.slate900 }}>{b.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Top Issue Categories</p>
            <p style={{ margin: '0 0 12px 0', fontSize: '11.5px', color: COLORS.slate500 }}>Raised in this period.</p>
            <SimpleBarChart data={summary.categoryChartData} series={[{ name: 'Tickets', color: COLORS.teal600 }]} />
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Compliance Health</p>
          <p style={{ margin: '0 0 14px 0', fontSize: '11.5px', color: COLORS.slate500 }}>Live, as of right now — {complianceTotal} statutory checks across the portfolio.</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '26px', flexWrap: 'wrap' }}>
            <svg width="130" height="130" viewBox="0 0 130 130" style={{ flexShrink: 0 }}>
              <circle cx="65" cy="65" r={R} fill="none" stroke={COLORS.slate100} strokeWidth="16" />
              <circle cx="65" cy="65" r={R} fill="none" stroke={COLORS.green600} strokeWidth="16" strokeLinecap="round" transform="rotate(-90 65 65)" {...arc(summary.complianceValid, 0)} />
              <circle cx="65" cy="65" r={R} fill="none" stroke={COLORS.amber600} strokeWidth="16" strokeLinecap="round" transform="rotate(-90 65 65)" {...arc(summary.complianceDueSoon, summary.complianceValid)} />
              <circle cx="65" cy="65" r={R} fill="none" stroke={COLORS.red600} strokeWidth="16" strokeLinecap="round" transform="rotate(-90 65 65)" {...arc(summary.complianceExpired, summary.complianceValid + summary.complianceDueSoon)} />
              <text x="65" y="61" textAnchor="middle" fontSize="20" fontWeight="800" fill={COLORS.slate900}>{compliancePct != null ? `${compliancePct}%` : '—'}</text>
              <text x="65" y="77" textAnchor="middle" fontSize="9" fontWeight="700" fill={COLORS.slate400}>COMPLIANT</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', flex: 1, minWidth: '180px' }}>
              {[
                ['Valid, in date', summary.complianceValid, COLORS.green600],
                ['Due within threshold', summary.complianceDueSoon, COLORS.amber600],
                ['Expired / no record', summary.complianceExpired, COLORS.red600],
              ].map(([label, value, colour]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', color: COLORS.slate900 }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: colour, flexShrink: 0 }} />
                  {label}
                  <span style={{ marginLeft: 'auto', fontWeight: 800 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Team Activity</p>
          <p style={{ margin: '0 0 12px 0', fontSize: '11.5px', color: COLORS.slate500 }}>Completed jobs by builder, this period.</p>
          {summary.teamActivity.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No jobs completed in this period yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${COLORS.slate900}` }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 800, color: COLORS.slate900 }}>Builder</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 800, color: COLORS.slate900 }}>Completed Jobs</th>
                </tr>
              </thead>
              <tbody>
                {summary.teamActivity.map(row => (
                  <tr key={row.id} style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                    <td style={{ padding: '6px 8px' }}>{row.name}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
