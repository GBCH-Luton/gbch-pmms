// Sandbox-only SIMS integration prototype -- not production-bound, not
// required for either PMMS or SIMS's launch. This page used to be a plain
// "Coming Soon" placeholder; it now mirrors SIMS's own item table (same
// columns: category, status, new/used/in-use breakdown, total, price,
// unit, low-stock flag) using whatever fetchAvailableMaterials() returns
// from lib/simsMaterialsBridge.js. Once a real SIMS-side bridge function
// exists, only simsMaterialsBridge.js needs to change -- this page doesn't.

import { useState, useEffect } from 'react'
import { COLORS } from '../../lib/colors'
import { fetchAvailableMaterials } from '../../lib/simsMaterialsBridge'

const thStyle = { textAlign: 'left', padding: '12px 16px', fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }
const tdStyle = { padding: '12px 16px', fontSize: '13px', color: COLORS.slate900, whiteSpace: 'nowrap' }

function formatPrice(value) {
  return `£${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function AdminStock() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAvailableMaterials().then(data => {
      setItems(data)
      setLoading(false)
    })
  }, [])

  return (
    <div>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Stock</h1>
      <p style={{ margin: '0 0 6px 0', fontSize: '13px', color: COLORS.slate500 }}>Maintenance stock and appliances available to builders when fixing a property.</p>
      <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: COLORS.amber600, fontWeight: 600 }}>
        Real SIMS catalog, but a static snapshot -- not a live connection. Won't reflect stock changes made in SIMS since 2026-07-22. See lib/simsMaterialsBridge.js.
      </p>

      <div style={{ background: COLORS.white, borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading stock...</p>
          </div>
        ) : items.length === 0 ? (
          <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No stock items found.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: COLORS.slate50 }}>
                  <th style={thStyle}>Item</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>New</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Used</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>In Use</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                  <th style={thStyle}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} style={{ borderTop: `1px solid ${COLORS.slate100}` }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      <span style={{ color: COLORS.slate400, marginRight: '6px' }}>▶</span>
                      {item.name}
                      {item.low_stock && (
                        <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 800, color: COLORS.red600, background: COLORS.red100, borderRadius: '999px', padding: '2px 8px' }}>
                          Low stock
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: COLORS.slate500 }}>{item.category}</td>
                    <td style={tdStyle}>{item.status}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity_new}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity_used}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{item.quantity_in_use}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{item.total_quantity}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{formatPrice(item.unit_price)}</td>
                    <td style={{ ...tdStyle, color: COLORS.slate500 }}>{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!loading && items.length > 0 && (
        <p style={{ margin: '12px 4px 0 4px', fontSize: '12px', color: COLORS.slate400 }}>Showing {items.length} of {items.length} items</p>
      )}
    </div>
  )
}
