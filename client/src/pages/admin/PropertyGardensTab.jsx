// Gardens tab of the Property Profile. See
// scripts/add_property_garden_columns.sql for the pmms.properties
// columns this component depends on -- run it before using this tab.
//
// has_garden is opt-in per property -- most properties won't have it
// set until an admin turns tracking on here. garden_last_attended_by
// is free text (not a staff_id) because attendance is a mix of
// internal staff and external contractors, who have no staff row.
// Staff-performed visits (raised under the existing "Grounds & External
// Works" category) auto-update garden_last_attended_date/_by on
// completion -- see BuilderDashboard.jsx's isGardenJob check. Contractor
// visits are entered here by hand, the only path they have.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { modalLabelStyle, modalErrorStyle, GARDEN_STATE_OPTIONS, GARDEN_STATE_STYLES, formatUKDate } from './shared'

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '14px' }
const readRowStyle = { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0' }
const readLabelStyle = { fontSize: '12px', fontWeight: 700, color: '#94a3b8' }
const uploadBtnStyle = { width: '100%', height: '44px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }

export default function PropertyGardensTab({ property, onFieldsSaved }) {
  const [editing, setEditing] = useState(false)
  const [state, setState] = useState(property.garden_state || '')
  const [lastAttendedDate, setLastAttendedDate] = useState(property.garden_last_attended_date || '')
  const [lastAttendedBy, setLastAttendedBy] = useState(property.garden_last_attended_by || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [frontUploading, setFrontUploading] = useState(false)
  const [backUploading, setBackUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')

  async function saveFields(fields) {
    const { error: updateError } = await supabase
      .schema('pmms')
      .from('properties')
      .update(fields)
      .eq('id', property.id)

    if (updateError) return updateError.message

    onFieldsSaved(fields)
    return null
  }

  async function toggleHasGarden(next) {
    setError('')
    const err = await saveFields({ has_garden: next })
    if (err) setError(err)
  }

  function startEdit() {
    setState(property.garden_state || '')
    setLastAttendedDate(property.garden_last_attended_date || '')
    setLastAttendedBy(property.garden_last_attended_by || '')
    setError('')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError('')

    const err = await saveFields({
      garden_state: state || null,
      garden_last_attended_date: lastAttendedDate || null,
      garden_last_attended_by: lastAttendedBy.trim() || null,
    })

    setSaving(false)
    if (err) { setError(err); return }
    setEditing(false)
  }

  async function handlePhotoUpload(e, side) {
    const file = e.target.files?.[0]
    if (!file) return

    const setUploading = side === 'front' ? setFrontUploading : setBackUploading
    setUploading(true)
    setPhotoError('')

    const path = `${property.id}/garden-${side}-${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('property-photos').upload(path, file)

    if (uploadError) {
      setUploading(false)
      setPhotoError(`Upload failed: ${uploadError.message}`)
      return
    }

    const photoUrl = supabase.storage.from('property-photos').getPublicUrl(path).data.publicUrl
    const err = await saveFields({ [side === 'front' ? 'garden_front_photo_url' : 'garden_back_photo_url']: photoUrl })
    setUploading(false)
    if (err) setPhotoError(err)
  }

  if (!property.has_garden) {
    return (
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Gardens</p>
        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
          This property isn't currently marked as having a garden. Turn tracking on if it does.
        </p>
        <button
          onClick={() => toggleHasGarden(true)}
          style={{ padding: '10px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          This property has a garden
        </button>
        {error && <p style={modalErrorStyle}>{error}</p>}
      </div>
    )
  }

  const currentStyle = GARDEN_STATE_STYLES[property.garden_state]

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Gardens</p>
        {!editing && (
          <button
            onClick={startEdit}
            style={{ padding: '6px 14px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div style={{ marginBottom: '20px' }}>
          <div style={readRowStyle}>
            <span style={readLabelStyle}>State</span>
            {property.garden_state ? (
              <span style={{ fontSize: '11px', fontWeight: 800, color: currentStyle.color, background: currentStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>
                {property.garden_state}
              </span>
            ) : (
              <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Not set</span>
            )}
          </div>
          <div style={readRowStyle}>
            <span style={readLabelStyle}>Last Attended</span>
            <span style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
              {property.garden_last_attended_date
                ? `${formatUKDate(property.garden_last_attended_date)}${property.garden_last_attended_by ? ` — ${property.garden_last_attended_by}` : ''}`
                : 'Never recorded'}
            </span>
          </div>
          <div style={{ ...readRowStyle, justifyContent: 'flex-start' }}>
            <button
              onClick={() => toggleHasGarden(false)}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', color: '#94a3b8', cursor: 'pointer', textDecoration: 'underline' }}
            >
              This property no longer has a garden
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: '20px' }}>
          <p style={modalLabelStyle}>State</p>
          <select value={state} onChange={(e) => setState(e.target.value)} style={inputStyle}>
            <option value="">Not set</option>
            {GARDEN_STATE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          <p style={modalLabelStyle}>Last Attended Date</p>
          <input type="date" value={lastAttendedDate || ''} onChange={(e) => setLastAttendedDate(e.target.value)} style={inputStyle} />

          <p style={modalLabelStyle}>Attended By</p>
          <input
            type="text"
            placeholder="Staff name, or a contractor/company name"
            value={lastAttendedBy}
            onChange={(e) => setLastAttendedBy(e.target.value)}
            style={inputStyle}
          />

          {error && <p style={modalErrorStyle}>{error}</p>}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setEditing(false)} style={{ flex: 1, padding: '10px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{ flex: 2, padding: '10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Front Garden</p>
          {property.garden_front_photo_url && (
            <img src={property.garden_front_photo_url} alt="Front garden" style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', borderRadius: '10px', display: 'block', marginBottom: '8px' }} />
          )}
          <input type="file" accept="image/*" id="garden-front-photo-input" onChange={(e) => handlePhotoUpload(e, 'front')} style={{ display: 'none' }} />
          <button onClick={() => document.getElementById('garden-front-photo-input').click()} disabled={frontUploading} style={{ ...uploadBtnStyle, cursor: frontUploading ? 'not-allowed' : 'pointer' }}>
            {frontUploading ? 'Uploading...' : property.garden_front_photo_url ? 'Change front photo' : 'Upload front photo'}
          </button>
        </div>

        <div style={{ flex: '1 1 220px' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Back Garden</p>
          {property.garden_back_photo_url && (
            <img src={property.garden_back_photo_url} alt="Back garden" style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', borderRadius: '10px', display: 'block', marginBottom: '8px' }} />
          )}
          <input type="file" accept="image/*" id="garden-back-photo-input" onChange={(e) => handlePhotoUpload(e, 'back')} style={{ display: 'none' }} />
          <button onClick={() => document.getElementById('garden-back-photo-input').click()} disabled={backUploading} style={{ ...uploadBtnStyle, cursor: backUploading ? 'not-allowed' : 'pointer' }}>
            {backUploading ? 'Uploading...' : property.garden_back_photo_url ? 'Change back photo' : 'Upload back photo'}
          </button>
        </div>
      </div>
      {photoError && <p style={modalErrorStyle}>{photoError}</p>}
    </div>
  )
}
