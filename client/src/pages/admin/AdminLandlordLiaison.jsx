// Landlord Liaison Manager's control screen, same recipe as
// AdminHousekeeping.jsx / AdminCompliance.jsx: a division dashboard built
// from existing data rather than new tables. A directory of every
// property that has landlord contact details on file (pulled from the
// existing Lease & Legal fields on pmms.properties -- see
// PropertyLeaseLegalTab.jsx). Rows link out to the property's Lease &
// Legal tab rather than duplicating that UI.
//
// Used to also carry an "Open Tickets" section (Landlord Liaison
// category, open statuses) -- dropped 2026-08-18, since Pipeline already
// shows the exact same tickets (now with its own property filter too),
// and this was the whole reason the Landlord Liaison Manager's own nav
// item was hidden for a while ("she already has Pipeline for the same
// tickets"). The directory stayed because it's the only place that data
// lives -- nothing else in the app shows it.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import PropertySearchSelect from '../../components/PropertySearchSelect'

const cardStyle = { background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const sectionTitleStyle = { margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }
const sectionSubtitleStyle = { margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }

export default function AdminLandlordLiaison({ onNavigate }) {
  const [directory, setDirectory] = useState([])
  const [loading, setLoading] = useState(true)
  const [propertyFilter, setPropertyFilter] = useState('') // '' = All Properties, matches PropertySearchSelect's own cleared state

  useEffect(() => {
    fetchDirectory()
  }, [])

  async function fetchDirectory() {
    setLoading(true)
    const { data } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address, landlord_company, landlord_name, landlord_phone, landlord_email')
      .or('landlord_company.not.is.null,landlord_name.not.is.null,landlord_phone.not.is.null,landlord_email.not.is.null')
      .order('address')

    setDirectory(data || [])
    setLoading(false)
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading Landlord Liaison...</p>
    </div>
  )

  const propertyOptions = directory.map(p => ({ id: p.id, address: p.address })).sort((a, b) => a.address.localeCompare(b.address))
  const filteredDirectory = propertyFilter ? directory.filter(p => String(p.id) === String(propertyFilter)) : directory

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Landlord Liaison</h1>

      <div style={{ maxWidth: '360px', marginBottom: '16px' }}>
        <PropertySearchSelect properties={propertyOptions} value={propertyFilter} onChange={setPropertyFilter} placeholder="All Properties" />
      </div>

      <div style={cardStyle}>
        <p style={sectionTitleStyle}>Landlord Directory ({filteredDirectory.length})</p>
        <p style={sectionSubtitleStyle}>Every property with landlord contact details on file. Tap one to open its Lease &amp; Legal tab.</p>
        {filteredDirectory.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>{propertyFilter ? 'No landlord contact details on file for this property.' : 'No landlord contact details recorded yet.'}</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredDirectory.map(p => (
            <button
              key={p.id}
              onClick={() => onNavigate?.('properties', { propertyId: p.id, tab: 'Lease & Legal' })}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{p.address}</p>
                <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>
                  {p.landlord_company || p.landlord_name || 'No landlord name on file'}
                  {p.landlord_phone ? ` · ${p.landlord_phone}` : ''}
                </p>
              </div>
              {p.landlord_email && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.blue700, background: COLORS.blue100, padding: '3px 10px', borderRadius: '20px', flexShrink: 0 }}>{p.landlord_email}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
