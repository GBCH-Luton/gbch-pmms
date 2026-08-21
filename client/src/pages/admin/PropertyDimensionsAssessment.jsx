import { useState, useEffect } from 'react'
import { COLORS } from '../../lib/colors'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import { ROOM_TYPES, fetchAllProperties, fetchPropertyDimensions, saveDimensions } from '../../lib/dimensions'

// Real build of the "Dimensions Assessment" wizard -- reviewed and iterated
// on as a click-through mockup (Claude Artifact) before this, replacing a
// Microsoft Forms form nobody but the Landlord Liaison could see the
// results of. Structure/behaviour matches that approved mockup exactly:
// 5-step wizard, each room type starts at 1 row with "+ Add another" (down
// to 0 -- not every property has a garden), per-step Next validation, live
// area totals. See scripts/add_property_dimensions_assessment.sql.
const STEPS = [
  { key: 'bedroom', label: 'Bedrooms', singular: 'Bedroom', descLabel: 'Description of each bedroom' },
  { key: 'bathroom', label: 'Bathrooms', singular: 'Bath', descLabel: 'Description of each bathroom' },
  { key: 'kitchen', label: 'Kitchens', singular: 'Kitchen', descLabel: 'Description of each kitchen' },
  { key: 'garden', label: 'Gardens & Shared' },
  { key: 'review', label: 'Review & Submit' },
]

function emptyRow() { return { length: '', width: '', orientation: '' } }
function emptyRooms() { return { bedroom: [emptyRow()], bathroom: [emptyRow()], kitchen: [emptyRow()], garden: [emptyRow()], communal: [emptyRow()] } }

const cardStyle = { background: COLORS.white, borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '16px' }
const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }
const unitStyle = { margin: '0 0 6px 0', fontSize: '10.5px', color: COLORS.slate400, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }
const inputStyle = { width: '100%', height: '40px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', fontWeight: 700 }
const primaryBtn = { height: '46px', padding: '0 22px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { height: '44px', padding: '0 20px', background: COLORS.white, color: COLORS.slate500, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
const addBtn = { width: '100%', background: COLORS.teal50, color: COLORS.teal700, border: `1.5px dashed ${COLORS.teal700}`, borderRadius: '10px', padding: '11px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
const removeBtn = { background: 'none', border: 'none', color: COLORS.slate400, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }

function area(row) {
  const l = parseFloat(row.length), w = parseFloat(row.width)
  return (l && w) ? l * w : null
}
function totalArea(rows) {
  const areas = rows.map(area).filter(Boolean)
  return areas.length ? areas.reduce((a, b) => a + b, 0) : null
}
function fmtArea(v) { return v == null ? '—' : `${Math.round(v * 100) / 100} m²` }

export default function PropertyDimensionsAssessment({ profile, onNavigate, initialPropertyId, onInitialPropertyIdConsumed }) {
  const [properties, setProperties] = useState([])
  const [loadingProperties, setLoadingProperties] = useState(true)
  const [propertyId, setPropertyId] = useState('')
  const [loadingExisting, setLoadingExisting] = useState(false)
  const [step, setStep] = useState(0)
  const [rooms, setRooms] = useState(emptyRooms())
  const [desc, setDesc] = useState({ bedroom: '', bathroom: '', kitchen: '', gardenCommunal: '' })
  const [updateNote, setUpdateNote] = useState('')
  const [assessedInfo, setAssessedInfo] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    fetchAllProperties().then(list => { setProperties(list); setLoadingProperties(false) })
  }, [])

  // Consumed once -- a later render of this same page (e.g. navigating away
  // and back via the sidebar) must not keep re-jumping to whatever property
  // was passed in that one time.
  useEffect(() => {
    if (initialPropertyId) {
      setPropertyId(initialPropertyId)
      onInitialPropertyIdConsumed?.()
    }
  }, [initialPropertyId])

  useEffect(() => {
    if (propertyId) loadExisting(propertyId)
  }, [propertyId])

  async function loadExisting(id) {
    setLoadingExisting(true)
    setError('')
    setStep(0)
    setSubmitted(false)

    const { rows, property } = await fetchPropertyDimensions(id)
    // Distinguishes "never assessed" (seed every type with 1 empty row, the
    // same convenience a brand new property gets) from "assessed with
    // genuinely zero of this type" (e.g. no garden -- redo must show that
    // as empty, not silently reintroduce a blank row that wasn't there).
    const hasBeenAssessed = rows.length > 0 || !!property.dimensions_assessed_at

    const next = { bedroom: [], bathroom: [], kitchen: [], garden: [], communal: [] }
    rows.forEach(r => {
      next[r.room_type][r.room_index - 1] = { length: String(r.length_m ?? ''), width: String(r.width_m ?? ''), orientation: r.orientation || '' }
    })
    ROOM_TYPES.forEach(type => {
      next[type] = next[type].filter(Boolean)
      if (next[type].length === 0 && !hasBeenAssessed) next[type] = [emptyRow()]
    })

    setRooms(next)
    setDesc({
      bedroom: property.bedroom_description || '',
      bathroom: property.bathroom_description || '',
      kitchen: property.kitchen_description || '',
      gardenCommunal: property.garden_communal_description || '',
    })
    setUpdateNote(property.dimensions_update_note || '')
    setAssessedInfo(property.dimensions_assessed_by_name ? { by: property.dimensions_assessed_by_name, at: property.dimensions_assessed_at } : null)
    setLoadingExisting(false)
  }

  function selectProperty(id) {
    setPropertyId(id)
  }

  function addRoom(type) {
    if (rooms[type].length >= 20) return
    setRooms(prev => ({ ...prev, [type]: [...prev[type], emptyRow()] }))
  }
  function removeRoom(type, idx) {
    setRooms(prev => ({ ...prev, [type]: prev[type].filter((_, i) => i !== idx) }))
  }
  function setDim(type, idx, field, value) {
    setRooms(prev => ({ ...prev, [type]: prev[type].map((r, i) => i === idx ? { ...r, [field]: value } : r) }))
  }

  function stepIsFilled(key) {
    if (key === 'review') return true
    const types = key === 'garden' ? ['garden', 'communal'] : [key]
    return types.every(type => rooms[type].every(r => r.length && r.width))
  }
  function allFilled() {
    return ROOM_TYPES.every(type => rooms[type].every(r => r.length && r.width))
  }

  function nextStep() {
    if (!stepIsFilled(STEPS[step].key)) return
    if (step < STEPS.length - 1) setStep(step + 1)
  }
  function prevStep() { if (step > 0) setStep(step - 1) }

  async function handleSubmit() {
    if (!allFilled()) return
    setSaving(true)
    setError('')
    try {
      await saveDimensions(propertyId, { rooms, desc, updateNote, profile })
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  function backToPicker() {
    setPropertyId('')
    setRooms(emptyRooms())
    setDesc({ bedroom: '', bathroom: '', kitchen: '', gardenCommunal: '' })
    setUpdateNote('')
    setSubmitted(false)
    setError('')
  }

  const selectedProperty = properties.find(p => String(p.id) === String(propertyId))

  function dimRows(type, singular) {
    return rooms[type].map((r, i) => {
      const a = area(r)
      return (
        <div key={i} style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '14px', marginBottom: '10px', background: COLORS.slate50 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 700, color: COLORS.slate700 }}>{singular} {i + 1}</span>
            <button onClick={() => removeRoom(type, i)} style={removeBtn}>✕ Remove</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: type === 'garden' ? '1fr 1fr 1fr auto' : '1fr 1fr auto', gap: '14px', alignItems: 'end' }}>
            <div>
              <label style={fieldLabelStyle}>Length</label>
              <p style={unitStyle}>in meters</p>
              <input type="number" min="0" step="0.01" value={r.length} onChange={e => setDim(type, i, 'length', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={fieldLabelStyle}>Width</label>
              <p style={unitStyle}>in meters</p>
              <input type="number" min="0" step="0.01" value={r.width} onChange={e => setDim(type, i, 'width', e.target.value)} style={inputStyle} />
            </div>
            {type === 'garden' && (
              <div>
                <label style={fieldLabelStyle}>Orientation</label>
                <p style={unitStyle}>optional</p>
                <select value={r.orientation} onChange={e => setDim(type, i, 'orientation', e.target.value)} style={{ ...inputStyle, fontWeight: 500 }}>
                  <option value="">—</option>
                  <option value="front">Front</option>
                  <option value="back">Back</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}
            <div style={{ fontSize: '11px', fontWeight: 700, color: a ? COLORS.teal700 : COLORS.slate400, whiteSpace: 'nowrap', paddingBottom: '10px' }}>{a ? fmtArea(a) : 'area'}</div>
          </div>
        </div>
      )
    })
  }

  function emptyState(label) {
    return <p style={{ margin: '0 0 12px 0', fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic' }}>No {label} recorded for this property.</p>
  }

  function roomStep(type) {
    const s = STEPS.find(x => x.key === type)
    const total = totalArea(rooms[type])
    const count = rooms[type].length
    return (
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>{s.label}</h2>
          {total != null && <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.teal700, background: COLORS.teal50, padding: '3px 10px', borderRadius: '999px' }}>{fmtArea(total)} total</span>}
        </div>
        <div style={{ marginBottom: '18px' }}>
          <label style={fieldLabelStyle}>{s.descLabel}</label>
          <textarea value={desc[type]} onChange={e => setDesc(prev => ({ ...prev, [type]: e.target.value }))} style={{ width: '100%', minHeight: '44px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }} />
        </div>
        {count === 0 ? emptyState(s.label.toLowerCase()) : dimRows(type, s.singular)}
        <button onClick={() => addRoom(type)} style={addBtn}>+ Add {count === 0 ? 'a' : 'another'} {s.singular.toLowerCase()}</button>
      </div>
    )
  }

  function gardenStep() {
    const gTotal = totalArea(rooms.garden), cTotal = totalArea(rooms.communal)
    const combined = (gTotal || 0) + (cTotal || 0)
    return (
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>Gardens &amp; Shared Living Space</h2>
          {(gTotal != null || cTotal != null) && <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.teal700, background: COLORS.teal50, padding: '3px 10px', borderRadius: '999px' }}>{fmtArea(combined)} total</span>}
        </div>
        <p style={{ margin: '0 0 16px 0', fontSize: '12.5px', color: COLORS.slate400 }}>Any other common rooms not accounted for above, such as communal lounges. Do not include closets, umbrella cupboards etc.</p>
        <div style={{ marginBottom: '18px' }}>
          <label style={fieldLabelStyle}>Property description of each shared living space or garden</label>
          <textarea value={desc.gardenCommunal} onChange={e => setDesc(prev => ({ ...prev, gardenCommunal: e.target.value }))} style={{ width: '100%', minHeight: '64px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }} />
        </div>

        <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', fontWeight: 700, color: COLORS.slate700 }}>Gardens</p>
        {rooms.garden.length === 0 ? emptyState('gardens') : dimRows('garden', 'Garden')}
        <button onClick={() => addRoom('garden')} style={addBtn}>+ Add {rooms.garden.length === 0 ? 'a' : 'another'} garden</button>

        <div style={{ height: '20px' }} />
        <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', fontWeight: 700, color: COLORS.slate700 }}>Shared / Communal Spaces</p>
        {rooms.communal.length === 0 ? emptyState('shared living spaces') : dimRows('communal', 'Communal')}
        <button onClick={() => addRoom('communal')} style={addBtn}>+ Add {rooms.communal.length === 0 ? 'a' : 'another'} shared space</button>
      </div>
    )
  }

  function reviewStep() {
    const tiles = [
      { label: 'Bedrooms', value: totalArea(rooms.bedroom) },
      { label: 'Bathrooms', value: totalArea(rooms.bathroom) },
      { label: 'Kitchens', value: totalArea(rooms.kitchen) },
      { label: 'Gardens & Shared', value: (totalArea(rooms.garden) || 0) + (totalArea(rooms.communal) || 0) || null },
    ]
    const grand = tiles.reduce((sum, t) => sum + (t.value || 0), 0) || null
    return (
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>Review &amp; Submit</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          {tiles.map(t => (
            <div key={t.label} style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '12px 14px' }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: COLORS.slate400 }}>{t.label}</p>
              <p style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: COLORS.slate900 }}>{fmtArea(t.value)}</p>
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1.5px solid ${COLORS.slate200}`, paddingTop: '14px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>Total floor area</span>
          <span style={{ fontSize: '24px', fontWeight: 800, color: COLORS.teal700 }}>{grand ? Math.round(grand * 100) / 100 : '—'}{grand ? <small style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}> m²</small> : ''}</span>
        </div>
        <label style={fieldLabelStyle}>Update</label>
        <input type="text" value={updateNote} onChange={e => setUpdateNote(e.target.value)} placeholder="Anything else worth noting..." style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }} />
        {assessedInfo && (
          <p style={{ margin: '14px 0 0 0', fontSize: '11.5px', color: COLORS.slate400 }}>Last assessed by {assessedInfo.by}{assessedInfo.at ? ` on ${new Date(assessedInfo.at).toLocaleDateString('en-GB')}` : ''}.</p>
        )}
        {error && <p style={{ margin: '14px 0 0 0', fontSize: '12.5px', color: COLORS.red500, fontWeight: 600 }}>{error}</p>}
      </div>
    )
  }

  if (loadingProperties) return <p style={{ color: COLORS.slate500, fontSize: '13px' }}>Loading properties…</p>

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <span style={{ display: 'inline-block', background: COLORS.teal50, color: COLORS.teal700, fontSize: '10.5px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 12px', borderRadius: '999px', marginBottom: '10px' }}>Dimensions Assessment</span>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: COLORS.slate900 }}>Property Dimensions</h1>
      </div>

      {!propertyId ? (
        <div style={cardStyle}>
          <label style={fieldLabelStyle}>Property Address</label>
          <PropertySearchSelect properties={properties} value={propertyId} onChange={selectProperty} placeholder="Search by address..." />
        </div>
      ) : loadingExisting ? (
        <p style={{ color: COLORS.slate500, fontSize: '13px' }}>Loading this property's dimensions…</p>
      ) : submitted ? (
        <div style={{ ...cardStyle, textAlign: 'center', padding: '48px 30px' }}>
          <div style={{ fontSize: '34px', marginBottom: '8px' }}>✓</div>
          <h1 style={{ fontSize: '19px', margin: 0 }}>Dimensions Assessment saved</h1>
          <p style={{ marginTop: '8px', color: COLORS.slate500, fontSize: '13px' }}>{selectedProperty?.address}</p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px' }}>
            <button onClick={backToPicker} style={ghostBtn}>Assess another property</button>
            <button onClick={() => onNavigate?.('properties', { propertyId, tab: 'Dimensions' })} style={primaryBtn}>View property profile →</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Property Address</p>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{selectedProperty?.address}</p>
            </div>
            <button onClick={backToPicker} style={ghostBtn}>Change property</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', marginBottom: '20px', gap: '2px' }}>
            {STEPS.map((s, i) => {
              const isCurrent = i === step, isDone = i < step
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'flex-start' }}>
                  <button
                    onClick={() => setStep(i)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <span style={{ fontSize: '10.5px', fontWeight: 700, whiteSpace: 'nowrap', color: isCurrent ? COLORS.teal700 : isDone ? COLORS.slate500 : COLORS.slate400 }}>{s.label}</span>
                    <span style={{
                      width: '30px', height: '30px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: '13px', flexShrink: 0,
                      background: isCurrent ? COLORS.teal700 : isDone ? (COLORS.teal50) : COLORS.white,
                      border: `2px solid ${isCurrent || isDone ? COLORS.teal700 : COLORS.slate200}`,
                      color: isCurrent ? COLORS.white : isDone ? COLORS.teal700 : COLORS.slate400,
                    }}>
                      {isDone ? '✓' : i + 1}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && <div style={{ width: '18px', height: '2px', background: isDone ? COLORS.teal700 : COLORS.slate200, marginTop: '14px' }} />}
                </div>
              )
            })}
          </div>

          {STEPS[step].key === 'garden' ? gardenStep() : STEPS[step].key === 'review' ? reviewStep() : roomStep(STEPS[step].key)}

          {step < STEPS.length - 1 && !stepIsFilled(STEPS[step].key) && (
            <p style={{ margin: '-6px 0 12px 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>Every Length/Width field in this section needs a value before continuing.</p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            {step > 0 ? <button onClick={prevStep} style={ghostBtn}>← Back</button> : <span />}
            {step === STEPS.length - 1 ? (
              <button onClick={handleSubmit} disabled={!allFilled() || saving} style={{ ...primaryBtn, opacity: (!allFilled() || saving) ? 0.6 : 1, cursor: (!allFilled() || saving) ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving…' : 'Submit'}
              </button>
            ) : (
              <button onClick={nextStep} disabled={!stepIsFilled(STEPS[step].key)} style={{ ...primaryBtn, opacity: stepIsFilled(STEPS[step].key) ? 1 : 0.6, cursor: stepIsFilled(STEPS[step].key) ? 'pointer' : 'not-allowed' }}>
                Next →
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
