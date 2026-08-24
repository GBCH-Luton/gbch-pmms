import { formatUKDate, formatUKDateTime } from '../pages/admin/shared'
import { COLORS } from '../lib/colors'

// Same "print only this element" pattern as PrintableAttendanceReport.jsx --
// window.print() lets the browser's own "Save as PDF" destination do the
// actual export.
export default function PrintableMileageReport({ staffName, periodLabel, summary, onClose }) {
  const generatedAt = new Date()

  const stats = [
    ['Total Miles', summary.totalMiles.toFixed(1)],
    ['Trips Logged', summary.tripCount],
    ['Avg Miles / Trip', summary.tripCount ? summary.avgMilesPerTrip.toFixed(1) : '—'],
    ['Days With Travel', summary.daysWithTravel],
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

      <div className="pmms-print-area" style={{ padding: '32px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Mileage Report</h1>
        <p style={{ margin: '0 0 2px 0', fontSize: '13px', color: COLORS.slate600 }}>
          {staffName} &nbsp;|&nbsp; {periodLabel}
        </p>
        <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: COLORS.slate400 }}>
          Generated {formatUKDateTime(generatedAt.toISOString())}
        </p>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '24px' }}>
          {stats.map(([label, value]) => (
            <div key={label}>
              <p style={{ margin: '0 0 2px 0', fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
              <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>{value}</p>
            </div>
          ))}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${COLORS.slate900}` }}>
              {['Date', 'Type', 'Property', 'Coming From', 'Miles'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 800, color: COLORS.slate900 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.trips.map(t => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                <td style={{ padding: '6px 8px' }}>{formatUKDate(t.loggedAt)}</td>
                <td style={{ padding: '6px 8px' }}>{t.kind === 'ticket' ? `Job #${t.ticket_number}` : (t.activity_category === 'visit' ? 'Property Visit' : t.activity_category === 'visit_office' ? 'Office Visit' : 'Visit')}</td>
                <td style={{ padding: '6px 8px' }}>{t.property?.address || t.note || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{t.transit_start || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{Number(t.mileage_logged).toFixed(1)}</td>
              </tr>
            ))}
            {summary.trips.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '20px 8px', textAlign: 'center', color: COLORS.slate400 }}>No mileage logged in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
