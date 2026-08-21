import { useState, useEffect } from 'react'
import { COLORS } from '../../lib/colors'
import { ROOM_TYPES, fetchPropertyDimensions } from '../../lib/dimensions'

const ROOM_TYPE_META = {
  bedroom: { label: 'Bedrooms', singular: 'Bedroom', descKey: 'bedroom_description' },
  bathroom: { label: 'Bathrooms', singular: 'Bath', descKey: 'bathroom_description' },
  kitchen: { label: 'Kitchens', singular: 'Kitchen', descKey: 'kitchen_description' },
  garden: { label: 'Gardens', singular: 'Garden', descKey: null },
  communal: { label: 'Shared / Communal Spaces', singular: 'Communal', descKey: null },
}

function fmtArea(l, w) {
  if (!l || !w) return null
  return Math.round(l * w * 100) / 100
}

// Property Profile "Dimensions" tab -- read-only summary of whatever the
// Landlord Liaison (or anyone with access to this tab -- see
// PropertyDimensionsAssessment.jsx's own visibleTo gate for who that is)
// recorded via the Dimensions Assessment wizard. "Has a garden" and
// front/back/both are deliberately derived from the rows themselves here,
// not read off the separate has_garden boolean the Gardens tab owns --
// see scripts/add_property_dimensions_assessment.sql for why those two
// are kept independent.
export default function PropertyDimensionsTab({ property, onNavigate }) {
  const [rows, setRows] = useState([])
  const [descFields, setDescFields] = useState({})
  const [assessedInfo, setAssessedInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [property.id])

  async function load() {
    setLoading(true)
    const { rows: r, property: p } = await fetchPropertyDimensions(property.id)
    setRows(r)
    setDescFields(p)
    setAssessedInfo(p.dimensions_assessed_by_name ? { by: p.dimensions_assessed_by_name, at: p.dimensions_assessed_at, note: p.dimensions_update_note } : null)
    setLoading(false)
  }

  if (loading) {
    return <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}><p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400 }}>Loading...</p></div>
  }

  const gardenRows = rows.filter(r => r.room_type === 'garden')
  const orientations = [...new Set(gardenRows.map(r => r.orientation).filter(Boolean))]
  const hasGarden = gardenRows.length > 0
  const grandTotal = rows.reduce((sum, r) => sum + (fmtArea(r.length_m, r.width_m) || 0), 0)

  return (
    <div>
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>Dimensions</p>
            {assessedInfo ? (
              <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>
                Last assessed by {assessedInfo.by}{assessedInfo.at ? ` on ${new Date(assessedInfo.at).toLocaleDateString('en-GB')}` : ''}
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate400, fontStyle: 'italic' }}>Not yet assessed.</p>
            )}
          </div>
          <button
            onClick={() => onNavigate?.('property-dimensions', { propertyId: property.id })}
            style={{ padding: '8px 16px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {assessedInfo ? 'Redo Assessment' : 'Start Assessment'}
          </button>
        </div>

        {rows.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.teal700, background: COLORS.teal50, padding: '4px 12px', borderRadius: '999px' }}>
              Total floor area: {Math.round(grandTotal * 100) / 100} m²
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: hasGarden ? COLORS.green700 : COLORS.slate500, background: hasGarden ? COLORS.green50 : COLORS.slate100, padding: '4px 12px', borderRadius: '999px' }}>
              {hasGarden ? `Garden — ${orientations.length ? orientations.join(' & ') : 'orientation not recorded'}` : 'No garden recorded'}
            </span>
          </div>
        )}

        {assessedInfo?.note && (
          <p style={{ margin: '14px 0 0 0', fontSize: '12.5px', color: COLORS.slate500, fontStyle: 'italic' }}>“{assessedInfo.note}”</p>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: COLORS.slate400, fontSize: '13px', fontStyle: 'italic', background: COLORS.white, border: `1px dashed ${COLORS.slate200}`, borderRadius: '14px' }}>
          No dimensions have been recorded for this property yet.
        </div>
      ) : (
        ROOM_TYPES.map(type => {
          const meta = ROOM_TYPE_META[type]
          const typeRows = rows.filter(r => r.room_type === type)
          if (typeRows.length === 0 && !meta.descKey) return null
          const desc = meta.descKey ? descFields[meta.descKey] : (type === 'garden' || type === 'communal' ? descFields.garden_communal_description : null)
          return (
            <div key={type} style={{ background: COLORS.white, borderRadius: '16px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '10px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>{meta.label}</p>
              {desc && <p style={{ margin: '0 0 12px 0', fontSize: '12.5px', color: COLORS.slate500, fontStyle: 'italic' }}>{desc}</p>}
              {typeRows.length === 0 ? (
                <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic' }}>None recorded.</p>
              ) : (
                typeRows.map(r => {
                  const a = fmtArea(r.length_m, r.width_m)
                  return (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${COLORS.slate100}` }}>
                      <span style={{ fontSize: '12.5px', color: COLORS.slate700 }}>
                        {meta.singular} {r.room_index}{r.orientation ? ` (${r.orientation})` : ''} — {r.length_m ?? '—'}m × {r.width_m ?? '—'}m
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.teal700 }}>{a != null ? `${a} m²` : '—'}</span>
                    </div>
                  )
                })
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
