import { formatUKDateTime } from '../pages/admin/shared'
import { COLORS } from '../lib/colors'
import SimpleBarChart from './SimpleBarChart'

// A real, permanent, board-ready report -- deterministic from live data,
// no AI involved. Built after a director asked for "something visual" and
// the Claude Q&A box on this same page turned out to only return text;
// this is the actual fix, not a one-off mockup. Same
// ".pmms-no-print"/".pmms-print-area" pattern as every other Printable*
// component (see PrintableAttendanceReport.jsx).
export default function PrintableOperationsSnapshot({ summary, onClose }) {
  const generatedAt = new Date()
  const complianceTotal = summary.complianceValid + summary.complianceDueSoon + summary.complianceExpired
  const compliancePct = complianceTotal > 0 ? Math.round((summary.complianceValid / complianceTotal) * 100) : null

  const kpis = [
    ['Raised Today', summary.raisedToday],
    ['Completed Today', summary.completedToday],
    ['Currently Open', summary.currentlyOpenCount],
    ['Properties Managed', summary.totalProperties],
  ]

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
        <div style={{ background: COLORS.brandNavy, borderRadius: '16px', padding: '28px 26px', marginBottom: '24px' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>GBCH · Property Maintenance Management</p>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '22px', fontWeight: 800, color: COLORS.white }}>Operations Snapshot</h1>
          <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.75)' }}>Generated {formatUKDateTime(generatedAt.toISOString())} UK — a point-in-time read, not a live feed.</p>
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
            <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Ticket Pipeline</p>
            <SimpleBarChart data={summary.pipelineChartData} series={[{ name: 'Tickets', color: COLORS.blue500 }]} />
          </div>
          <div>
            <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Top Issue Categories</p>
            <SimpleBarChart data={summary.categoryChartData} series={[{ name: 'Tickets', color: COLORS.teal600 }]} />
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Compliance Health</p>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.slate500 }}>
            {compliancePct != null ? `${compliancePct}% of ${complianceTotal} statutory checks are valid and in date.` : 'No compliance records yet.'}
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 140px', background: COLORS.green100, borderRadius: '10px', padding: '12px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '10px', fontWeight: 700, color: COLORS.green600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Valid</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.green600 }}>{summary.complianceValid}</p>
            </div>
            <div style={{ flex: '1 1 140px', background: COLORS.amber100, borderRadius: '10px', padding: '12px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '10px', fontWeight: 700, color: COLORS.amber700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Due Soon</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.amber700 }}>{summary.complianceDueSoon}</p>
            </div>
            <div style={{ flex: '1 1 140px', background: COLORS.red100, borderRadius: '10px', padding: '12px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '10px', fontWeight: 700, color: COLORS.red600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Expired / No Record</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.red600 }}>{summary.complianceExpired}</p>
            </div>
          </div>
        </div>

        <div>
          <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>Team Activity</p>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.slate500 }}>Completed jobs by builder (all-time).</p>
          {summary.teamActivity.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No completed jobs recorded yet.</p>
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
