// Placeholder page for the future Stock/Inventory feature. Once the
// company's stock management system exists, this page will link to (or be
// fed from) it to show maintenance stock -- fridges, stoves, kettles,
// bathtubs, and similar property fittings/appliances that builders draw on
// to fix a property -- rather than PMMS managing that stock itself.

export default function AdminStock() {
  return (
    <div>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Stock</h1>
      <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>Maintenance stock and appliances available to builders when fixing a property.</p>

      <div style={{ background: '#fff', borderRadius: '16px', padding: '48px 24px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
        <p style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>Coming Soon</p>
        <p style={{ margin: '0 auto', maxWidth: '440px', fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
          This page will show maintenance stock -- fridges, stoves, kettles, bathtubs, and similar property fittings -- once it's linked to and fed from the company's central stock management system.
        </p>
      </div>
    </div>
  )
}
