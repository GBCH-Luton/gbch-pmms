import { formatUKDate, formatUKDateTime, formatDuration, formatDurationDays } from '../pages/admin/shared'
import { COLORS } from '../lib/colors'

// Same "print only this element" pattern as PrintableTicketReport.jsx (the
// @media print rule lives in client/src/index.css) -- window.print() lets
// the browser's own "Save as PDF" destination do the actual export, rather
// than pulling in a PDF-generation library just for this.
export default function PrintableAttendanceReport({ staffName, periodLabel, rangeLabel, summary, onClose }) {
  const generatedAt = new Date()

  const stats = [
    ['Total Hours', formatDurationDays(summary.totalMs)],
    ['Days Worked', summary.daysWorked],
    ['Late', summary.lateCount],
    ['Left Early', summary.earlyLeaveCount],
    ['Overtime', summary.overtimeCount],
    ['Missed Clock-Outs', summary.missedClockOutCount],
    ['Still Open', summary.incompleteCount],
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
        <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Attendance &amp; Hours Report</h1>
        <p style={{ margin: '0 0 2px 0', fontSize: '13px', color: COLORS.slate600 }}>
          {staffName} &nbsp;|&nbsp; {periodLabel}: <strong>{rangeLabel}</strong>
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
              {['Date', 'Clock In', 'Clock Out', 'Hours', 'Notes'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 800, color: COLORS.slate900 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.days.map(day => {
              const notes = []
              if (day.late_flag) notes.push('Late')
              if (day.early_leave_reason) notes.push(`Left early: ${day.early_leave_reason}`)
              if (day.overtime) notes.push('Overtime')
              if (day.clock_in_override || day.clock_out_override) notes.push('Manager override')
              if (day.incomplete) notes.push('No clock-out')
              else if (day.wasMissed) notes.push('Missed clock-out (corrected)')
              else if (!day.clock_out_at) notes.push('Still clocked in')
              return (
                <tr key={day.id} style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                  <td style={{ padding: '6px 8px' }}>{formatUKDate(day.work_date)}</td>
                  <td style={{ padding: '6px 8px' }}>{formatUKDateTime(day.clock_in_at).split(' ').slice(-1)[0]}</td>
                  <td style={{ padding: '6px 8px' }}>{day.clock_out_at ? formatUKDateTime(day.clock_out_at).split(' ').slice(-1)[0] : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{day.durationMs != null ? formatDuration(day.durationMs) : '—'}{day.isLive ? ' (so far)' : ''}</td>
                  <td style={{ padding: '6px 8px' }}>{notes.join(', ') || '—'}</td>
                </tr>
              )
            })}
            {summary.days.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '20px 8px', textAlign: 'center', color: COLORS.slate400 }}>No attendance recorded in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
