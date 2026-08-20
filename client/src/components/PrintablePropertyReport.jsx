import { useState } from 'react'
import { formatUKDate } from '../pages/admin/shared'
import { COLORS } from '../lib/colors'

// Same pattern as PrintableTicketReport.jsx (Pipeline's "Generate a Report")
// -- renders whatever's currently filtered on the Properties page as a
// clean, self-explanatory report, with print and CSV/Excel export sharing
// one column definition so they can't drift apart. `properties` is expected
// pre-enriched with `openTicketsCount`/`voidRoomsCount` (AdminProperties.jsx
// keeps those in separate id-keyed maps, not on the property row itself).
export default function PrintablePropertyReport({ properties, filterLabel, onClose }) {
  const generatedAt = new Date()
  const [columnsOpen, setColumnsOpen] = useState(false)

  const COLUMN_DEFS = [
    { key: 'address', label: 'Property', value: p => p.address || '' },
    { key: 'postcode', label: 'Postcode', value: p => p.postcode || '' },
    { key: 'town', label: 'Town', value: p => p.town || '' },
    { key: 'type', label: 'Type', value: p => p.property_type || '' },
    { key: 'status', label: 'Status', value: p => p.status || '' },
    { key: 'openTickets', label: 'Open Tickets', value: p => p.openTicketsCount ?? 0 },
    { key: 'voidRooms', label: 'Void Rooms', value: p => p.voidRoomsCount ?? 0 },
    { key: 'added', label: 'Added', value: p => p.created_at ? formatUKDate(p.created_at) : '' },
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

  function csvEscape(value) {
    const str = String(value ?? '')
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  function handleDownloadCsv() {
    const headers = activeColumns.map(c => c.label)
    const rows = properties.map(p => activeColumns.map(c => c.value(p)))
    // BOM so Excel (not just browsers) opens the accented/special characters
    // in an address correctly instead of mangling them.
    const csv = '﻿' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pmms-properties-${generatedAt.toISOString().slice(0, 10)}.csv`
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
            Download for Excel
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
        <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Property Report</h1>
        <p style={{ margin: '0 0 2px 0', fontSize: '13px', color: COLORS.slate600 }}>
          Showing: <strong>{filterLabel}</strong>
        </p>
        <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: COLORS.slate400 }}>
          Generated {formatUKDate(generatedAt.toISOString())} &nbsp;•&nbsp; {properties.length} propert{properties.length === 1 ? 'y' : 'ies'}
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
            {properties.map(p => (
              <tr key={p.id} style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                {activeColumns.map(c => {
                  const val = c.value(p)
                  return <td key={c.key} style={{ padding: '6px 8px' }}>{val === '' || val == null ? '—' : val}</td>
                })}
              </tr>
            ))}
            {properties.length === 0 && (
              <tr>
                <td colSpan={activeColumns.length} style={{ padding: '20px 8px', textAlign: 'center', color: COLORS.slate400 }}>No properties match the current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
