// Sandbox-only SIMS integration prototype -- not production-bound, not
// required for either PMMS or SIMS's launch. This page used to be a plain
// "Coming Soon" placeholder; it now renders whatever fetchAvailableMaterials()
// returns from lib/simsMaterialsBridge.js, so an admin/Maintenance Manager
// can see the (currently stubbed) Maintenance-division item catalog here
// directly, without needing to go through the builder ticket-completion
// flow to check the same data. Once a real SIMS-side bridge function
// exists, only simsMaterialsBridge.js needs to change -- this page doesn't.

import { useState, useEffect } from 'react'
import { fetchAvailableMaterials } from '../../lib/simsMaterialsBridge'

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
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Stock</h1>
      <p style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#64748b' }}>Maintenance stock and appliances available to builders when fixing a property.</p>
      <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: '#d97706', fontWeight: 600 }}>
        Prototype data -- not yet connected to real SIMS inventory. See lib/simsMaterialsBridge.js.
      </p>

      <div style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <p style={{ margin: 0, padding: '24px', fontSize: '13px', color: '#94a3b8' }}>Loading...</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Item</th>
                <th style={{ textAlign: 'left', padding: '12px 20px', fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Unit</th>
                <th style={{ textAlign: 'right', padding: '12px 20px', fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Available</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{item.name}</td>
                  <td style={{ padding: '12px 20px', fontSize: '13px', color: '#64748b' }}>{item.unit}</td>
                  <td style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 700, color: '#0f172a', textAlign: 'right' }}>{item.available_quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
