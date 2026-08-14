import { useState } from 'react'
import { resolveCategoryDivision, priorityTierLabel, formatUKDate, statusLabel } from '../pages/admin/shared'
import { COLORS } from '../lib/colors'

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
  const [columnsOpen, setColumnsOpen] = useState(false)

  // Single source of truth for both the CSV export and the on-screen/print
  // table, so picking columns only has to happen once and the two can never
  // drift out of sync with each other.
  const COLUMN_DEFS = [
    { key: 'ticketNumber', label: 'Ticket #', value: t => t.ticket_number },
    { key: 'property', label: 'Property', value: t => t.property?.address || '' },
    // Same field Pipeline's own expanded ticket view labels "Issue" (the
    // free-text description of what's actually wrong) -- not a separate
    // taxonomy, just this column reusing that label for consistency.
    { key: 'issue', label: 'Issue', value: t => t.description || '' },
    { key: 'category', label: 'Category', value: t => t.category || '' },
    { key: 'division', label: 'Division', value: t => resolveCategoryDivision(t.category, categoriesSettingsRow) },
    { key: 'status', label: 'Status', value: t => statusLabel(t.status) },
    { key: 'priority', label: 'Priority', value: t => t.priority_override || priorityTierLabel(t.priority_score) },
    { key: 'raised', label: 'Raised', value: t => t.created_at ? formatUKDate(t.created_at) : '' },
    { key: 'completed', label: 'Completed', value: t => t.completed_at ? formatUKDate(t.completed_at) : '' },
    { key: 'builder', label: 'Assigned Builder', value: t => t.builderName || '' },
  ]

  const [visibleKeys, setVisibleKeys] = useState(() => COLUMN_DEFS.map(c => c.key))
  const activeColumns = COLUMN_DEFS.filter(c => visibleKeys.includes(c.key))

  function toggleColumn(key) {
    setVisibleKeys(prev => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev // always leave at least one column showing
        return prev.filter(k => k !== key)
      }
      return [...prev, key]
    })
  }

  const rangeLabel = fromDate || toDate
    ? `${fromDate ? formatUKDate(fromDate) : 'Any'} — ${toDate ? formatUKDate(toDate) : 'Any'}`
    : 'All time'

  function csvEscape(value) {
    const str = String(value ?? '')
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  function handleDownloadCsv() {
    const headers = activeColumns.map(c => c.label)
    const rows = tickets.map(t => activeColumns.map(c => c.value(t)))
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: COLORS.white, overflowY: 'auto' }}>
      <div className="pmms-no-print" style={{
        position: 'sticky', top: 0, background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}`,
        padding: '12px 20px', display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 1,
      }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setColumnsOpen(prev => !prev)}
            style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate900, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
          >
            Columns ({activeColumns.length}/{COLUMN_DEFS.length}) {columnsOpen ? '▲' : '▼'}
          </button>
          {columnsOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, background: COLORS.white, border: `1px solid ${COLORS.slate200}`,
              borderRadius: '10px', padding: '10px 14px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: '200px',
            }}>
              {COLUMN_DEFS.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: COLORS.slate600, padding: '4px 0', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={visibleKeys.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleDownloadCsv} style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate900, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            Download CSV
          </button>
          <button onClick={() => window.print()} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: COLORS.slate900, color: COLORS.white, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            Print
          </button>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>

      <div className="pmms-print-area" style={{ padding: '32px', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Ticket Report</h1>
        <p style={{ margin: '0 0 2px 0', fontSize: '13px', color: COLORS.slate600 }}>
          Division: <strong>{divisionLabel}</strong> &nbsp;|&nbsp; Date range: <strong>{rangeLabel}</strong>
        </p>
        <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: COLORS.slate400 }}>
          Generated {formatUKDate(generatedAt.toISOString())} &nbsp;•&nbsp; {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: COLORS.slate100, borderBottom: `2px solid ${COLORS.slate900}` }}>
              {activeColumns.map(c => (
                <th key={c.key} style={{ textAlign: 'left', padding: '8px', fontWeight: 800, color: COLORS.slate900 }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.map(t => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                {activeColumns.map(c => (
                  <td key={c.key} style={{ padding: '6px 8px' }}>{c.value(t) || '—'}</td>
                ))}
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={activeColumns.length} style={{ padding: '20px 8px', textAlign: 'center', color: COLORS.slate400 }}>No tickets match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
