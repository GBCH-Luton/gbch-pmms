import { resolveCategoryDivision, priorityTierLabel, formatUKDate, statusLabel } from '../pages/admin/shared'

// Renders whatever's currently filtered on the Pipeline page as a clean,
// self-explanatory report -- a title/filter summary so a printed or CSV'd
// copy makes sense to whoever receives it (a landlord, a compliance body),
// not just a bare table with no context.
//
// Print uses the standard "print only this element" CSS trick (the
// @media print rule lives in client/src/index.css) rather than hiding the
// surrounding app chrome piece by piece -- more robust regardless of
// z-index/overlay stacking elsewhere in the app.
export default function PrintableTicketReport({ tickets, categoriesSettingsRow, divisionLabel, fromDate, toDate, onClose }) {
  const generatedAt = new Date()

  const rangeLabel = fromDate || toDate
    ? `${fromDate ? formatUKDate(fromDate) : 'Any'} — ${toDate ? formatUKDate(toDate) : 'Any'}`
    : 'All time'

  function csvEscape(value) {
    const str = String(value ?? '')
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  function handleDownloadCsv() {
    const headers = ['Ticket #', 'Property', 'Category', 'Division', 'Status', 'Priority', 'Raised', 'Completed', 'Assigned Builder']
    const rows = tickets.map(t => [
      t.ticket_number,
      t.property?.address || '',
      t.category || '',
      resolveCategoryDivision(t.category, categoriesSettingsRow),
      statusLabel(t.status),
      t.priority_override || priorityTierLabel(t.priority_score),
      t.created_at ? formatUKDate(t.created_at) : '',
      t.completed_at ? formatUKDate(t.completed_at) : '',
      t.builderName || '',
    ])
    const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pmms-tickets-${generatedAt.toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: '#fff', overflowY: 'auto' }}>
      <div className="pmms-no-print" style={{
        position: 'sticky', top: 0, background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
        padding: '12px 20px', display: 'flex', gap: '10px', justifyContent: 'flex-end', zIndex: 1,
      }}>
        <button onClick={handleDownloadCsv} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Download CSV
        </button>
        <button onClick={() => window.print()} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: '#0f172a', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Print
        </button>
        <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Close
        </button>
      </div>

      <div className="pmms-print-area" style={{ padding: '32px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>Ticket Report</h1>
        <p style={{ margin: '0 0 2px 0', fontSize: '13px', color: '#475569' }}>
          Division: <strong>{divisionLabel}</strong> &nbsp;|&nbsp; Date range: <strong>{rangeLabel}</strong>
        </p>
        <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: '#94a3b8' }}>
          Generated {formatUKDate(generatedAt.toISOString())} &nbsp;•&nbsp; {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #0f172a' }}>
              {['Ticket #', 'Property', 'Category', 'Division', 'Status', 'Priority', 'Raised', 'Completed', 'Assigned Builder'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 800, color: '#0f172a' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '6px 8px' }}>{t.ticket_number}</td>
                <td style={{ padding: '6px 8px' }}>{t.property?.address || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{t.category || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{resolveCategoryDivision(t.category, categoriesSettingsRow)}</td>
                <td style={{ padding: '6px 8px' }}>{statusLabel(t.status)}</td>
                <td style={{ padding: '6px 8px' }}>{t.priority_override || priorityTierLabel(t.priority_score)}</td>
                <td style={{ padding: '6px 8px' }}>{t.created_at ? formatUKDate(t.created_at) : '—'}</td>
                <td style={{ padding: '6px 8px' }}>{t.completed_at ? formatUKDate(t.completed_at) : '—'}</td>
                <td style={{ padding: '6px 8px' }}>{t.builderName || '—'}</td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: '20px 8px', textAlign: 'center', color: '#94a3b8' }}>No tickets match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
