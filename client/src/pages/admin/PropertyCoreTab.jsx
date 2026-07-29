// Core tab of the Property Profile. See scripts/add_property_core_profile_columns.sql
// and scripts/add_property_photo_storage.sql for the DB columns + storage
// bucket this component depends on -- run both before using this tab.
//
// Three fields intentionally reuse existing pmms.properties columns instead
// of the new ones a naive read of the spec would suggest, because those
// existing columns already drive live Builder-side behaviour:
//   - Electric Shutoff Location -> electrical_shutoff (Job Detail Access & Safety card)
//   - Vulnerability Flag/Notes  -> high_vulnerability / vulnerability_reason
//     (Job Detail alert banner + the +30 priority score bonus)
// "Layout Type" (Studio/1-Bed/.../HMO) uses a NEW column, unit_layout_type,
// so it doesn't collide with the existing layout_type column that drives
// the Builder's floor/area picker (2-Floors/3-Floors/Flat).

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { modalLabelStyle, modalErrorStyle, fetchAssignableStaffForCategory } from './shared'
import { compressImage } from '../../lib/imageCompression'

const PROPERTY_TYPES = ['House', 'Flat', 'HMO', 'Specialist Supported Living', 'Commercial', 'Other']
const TENURE_TYPES = ['Freehold', 'Leasehold', 'Rented']
const PROPERTY_STATUSES = ['Occupied', 'Void', 'Procured', 'Live']
const UNIT_LAYOUT_TYPES = ['Studio', '1-Bed', '2-Bed', '3-Bed', '4-Bed', '5-Bed', 'HMO', 'Other']
const CONSTRUCTION_TYPES = ['Brick', 'Timber Frame', 'Concrete', 'Other']

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }
const readRowStyle = { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }
const readLabelStyle = { fontSize: '12px', fontWeight: 700, color: '#94a3b8' }
const readValueStyle = { fontSize: '13px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }

function fieldInput(field, value, onChange) {
  if (field.type === 'select') {
    return (
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">Select...</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
    )
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      style={inputStyle}
    />
  )
}

function formatReadValue(field, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (field.key === 'maps_link') {
    return <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', fontWeight: 700 }}>{value}</a>
  }
  return String(value)
}

function EditableSection({ title, fields, property, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    const initial = {}
    fields.forEach(f => { initial[f.key] = property[f.key] })
    setDraft(initial)
    setError('')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError('')
    const err = await onSave(draft)
    setSaving(false)
    if (err) { setError(err); return }
    setEditing(false)
  }

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>{title}</p>
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
        <div>
          {fields.map(f => (
            <div key={f.key} style={readRowStyle}>
              <span style={readLabelStyle}>{f.label}</span>
              <span style={readValueStyle}>{formatReadValue(f, property[f.key])}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {fields.map(f => (
            <div key={f.key}>
              <p style={modalLabelStyle}>{f.label}</p>
              {fieldInput(f, draft[f.key], (v) => setDraft(prev => ({ ...prev, [f.key]: v })))}
            </div>
          ))}

          {error && <p style={modalErrorStyle}>{error}</p>}

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
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
    </div>
  )
}

function VulnerabilitySection({ property, onSave, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [flag, setFlag] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setFlag(!!property.high_vulnerability)
    setNotes(property.vulnerability_reason || '')
    setError('')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError('')
    const err = await onSave({ high_vulnerability: flag, vulnerability_reason: flag ? notes : null })
    setSaving(false)
    if (err) { setError(err); return }
    setEditing(false)
  }

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Vulnerability</p>
        {!editing && !readOnly && (
          <button
            onClick={startEdit}
            style={{ padding: '6px 14px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div>
          <div style={readRowStyle}>
            <span style={readLabelStyle}>Vulnerability Flag</span>
            <span style={{ fontSize: '11px', fontWeight: 800, color: property.high_vulnerability ? '#dc2626' : '#16a34a', background: property.high_vulnerability ? '#fee2e2' : '#dcfce7', padding: '3px 10px', borderRadius: '20px' }}>
              {property.high_vulnerability ? 'ON' : 'OFF'}
            </span>
          </div>
          {property.high_vulnerability && (
            <div style={{ ...readRowStyle, borderBottom: 'none' }}>
              <span style={readLabelStyle}>Vulnerability Notes</span>
              <span style={readValueStyle}>{property.vulnerability_reason || '—'}</span>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Vulnerability Flag</span>
            <button
              onClick={() => setFlag(prev => !prev)}
              style={{
                width: '48px', height: '28px', borderRadius: '999px', border: 'none', cursor: 'pointer', position: 'relative',
                background: flag ? '#dc2626' : '#cbd5e1', transition: 'background 0.15s',
              }}
            >
              <span style={{
                position: 'absolute', top: '3px', left: flag ? '23px' : '3px', width: '22px', height: '22px',
                borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
              }} />
            </button>
          </div>

          {flag && (
            <div style={{ marginTop: '8px' }}>
              <p style={modalLabelStyle}>Vulnerability Notes</p>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          )}

          {error && <p style={modalErrorStyle}>{error}</p>}

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
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
    </div>
  )
}

// One cleaner per property (Cleaners Rota Phase 1). Reuses
// fetchAssignableStaffForCategory('Cleaning Rota') -- the exact same
// division-routing logic that already offers Housekeepers instead of
// Builders when raising a Housekeeping-division ticket -- rather than a
// bespoke staff query, so this list of assignable cleaners never drifts
// out of sync with who's actually eligible elsewhere in the app. When
// the property has a staff_gender_restriction set, the list is narrowed
// to staff whose `gender` matches -- an unset staff gender is treated as
// "unknown, don't offer" for a restricted property, matching the "only
// cleaners who match that requirement will be offered" spec.
function CleanerAssignmentSection({ property, onSave }) {
  const [editing, setEditing] = useState(false)
  const [cleaners, setCleaners] = useState([])
  const [cleanersLoading, setCleanersLoading] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [currentName, setCurrentName] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!property.assigned_cleaner_id) { setCurrentName(null); return }
    supabase.from('staff').select('name').eq('id', property.assigned_cleaner_id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setCurrentName(data?.name || null) })
    return () => { cancelled = true }
  }, [property.assigned_cleaner_id])

  async function startEdit() {
    setSelectedId(property.assigned_cleaner_id || '')
    setError('')
    setEditing(true)
    setCleanersLoading(true)
    const staff = await fetchAssignableStaffForCategory('Cleaning Rota')
    setCleaners(staff)
    setCleanersLoading(false)
  }

  const restrictionGender = { 'Male Only': 'Male', 'Female Only': 'Female' }[property.staff_gender_restriction]
  const eligibleCleaners = restrictionGender ? cleaners.filter(c => c.gender === restrictionGender) : cleaners

  async function save() {
    setSaving(true)
    setError('')
    const err = await onSave({
      assigned_cleaner_id: selectedId || null,
      cleaner_assigned_since: selectedId ? new Date().toISOString() : null,
    })
    setSaving(false)
    if (err) { setError(err); return }
    setEditing(false)
  }

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Assigned Cleaner</p>
        {!editing && (
          <button
            onClick={startEdit}
            style={{ padding: '6px 14px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            {property.assigned_cleaner_id ? 'Reassign' : 'Assign'}
          </button>
        )}
      </div>

      {!editing ? (
        <div style={readRowStyle}>
          <span style={readLabelStyle}>Responsible Cleaner</span>
          <span style={readValueStyle}>{currentName || '—'}</span>
        </div>
      ) : (
        <div>
          <p style={modalLabelStyle}>Cleaner</p>
          {cleanersLoading ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>Loading eligible cleaners...</p>
          ) : (
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={inputStyle}>
              <option value="">Unassigned</option>
              {eligibleCleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {!cleanersLoading && restrictionGender && eligibleCleaners.length === 0 && (
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#d97706' }}>
              No {restrictionGender.toLowerCase()} cleaners available to match this property's gender restriction.
            </p>
          )}

          {error && <p style={modalErrorStyle}>{error}</p>}

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
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
    </div>
  )
}

export default function PropertyCoreTab({ property, onFieldsSaved, profile }) {
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const isHousekeeping = profile?.division === 'Housekeeping'

  async function saveFields(fields) {
    const { error } = await supabase
      .schema('pmms')
      .from('properties')
      .update(fields)
      .eq('id', property.id)

    if (error) return error.message

    onFieldsSaved(fields)
    return null
  }

  async function handleCoverPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setPhotoUploading(true)
    setPhotoError('')

    const compressed = await compressImage(file)
    const path = `${property.id}/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('property-photos').upload(path, compressed)

    if (uploadError) {
      setPhotoUploading(false)
      setPhotoError(`Upload failed: ${uploadError.message}`)
      return
    }

    const photoUrl = supabase.storage.from('property-photos').getPublicUrl(path).data.publicUrl
    const err = await saveFields({ cover_photo_url: photoUrl })
    setPhotoUploading(false)
    if (err) setPhotoError(err)
  }

  return (
    <div>
      {property.high_vulnerability && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>
            ⚠ Vulnerable Occupant — {property.vulnerability_reason || 'No further details provided'}
          </p>
        </div>
      )}

      {isHousekeeping ? (
        // "Just what he interacts with, no more" -- same principle already
        // applied to the tab list itself. A Housekeeping Manager assigns
        // cleaners and needs to know about a vulnerable occupant before
        // sending someone in, but every other Core field (photo, property
        // details, structure, access/safety, utilities, location) is
        // Maintenance Manager territory.
        <>
          <VulnerabilitySection property={property} onSave={saveFields} readOnly />
          <CleanerAssignmentSection property={property} onSave={saveFields} />
        </>
      ) : (
        <>
          {/* Cover photo */}
          <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Cover Photo</p>
            {property.cover_photo_url && (
              <img src={property.cover_photo_url} alt="Property cover" style={{ width: '100%', maxHeight: '260px', objectFit: 'cover', borderRadius: '10px', display: 'block', marginBottom: '12px' }} />
            )}
            <input type="file" accept="image/*" id="cover-photo-input" onChange={handleCoverPhoto} style={{ display: 'none' }} />
            <button
              onClick={() => document.getElementById('cover-photo-input').click()}
              disabled={photoUploading}
              style={{ width: '100%', height: '44px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: photoUploading ? 'not-allowed' : 'pointer', boxSizing: 'border-box' }}
            >
              {photoUploading ? 'Uploading...' : property.cover_photo_url ? 'Change cover photo' : 'Upload cover photo'}
            </button>
            {photoError && <p style={modalErrorStyle}>{photoError}</p>}
          </div>

          <EditableSection
            title="Property Details"
            property={property}
            onSave={saveFields}
            fields={[
              { key: 'property_name', label: 'Property Name', type: 'text' },
              { key: 'address', label: 'Full Address', type: 'text' },
              { key: 'property_type', label: 'Property Type', type: 'select', options: PROPERTY_TYPES },
              { key: 'tenure_type', label: 'Tenure Type', type: 'select', options: TENURE_TYPES },
              { key: 'status', label: 'Property Status', type: 'select', options: PROPERTY_STATUSES },
              { key: 'unit_layout_type', label: 'Layout Type', type: 'select', options: UNIT_LAYOUT_TYPES },
              { key: 'construction_type', label: 'Construction Type', type: 'select', options: CONSTRUCTION_TYPES },
            ]}
          />

          <EditableSection
            title="Size & Structure"
            property={property}
            onSave={saveFields}
            fields={[
              { key: 'num_floors', label: 'Number of Floors', type: 'number' },
              { key: 'num_rooms', label: 'Number of Rooms (excl. bathrooms/kitchens)', type: 'number' },
              { key: 'num_bathrooms', label: 'Number of Bathrooms', type: 'number' },
              { key: 'num_kitchens', label: 'Number of Kitchens', type: 'number' },
              { key: 'floor_area_sqft', label: 'Total Floor Area (sq ft)', type: 'number' },
              { key: 'year_constructed', label: 'Year Constructed', type: 'number' },
            ]}
          />

          <EditableSection
            title="Access & Safety"
            property={property}
            onSave={saveFields}
            fields={[
              { key: 'access_instructions', label: 'Access Instructions', type: 'textarea' },
              { key: 'electrical_shutoff', label: 'Electric Shutoff Location', type: 'text' },
              { key: 'gas_shutoff', label: 'Gas Shutoff Location', type: 'text' },
              { key: 'emergency_contact', label: 'Emergency Contact', type: 'text' },
            ]}
          />

          <VulnerabilitySection property={property} onSave={saveFields} />

          <CleanerAssignmentSection property={property} onSave={saveFields} />

          <EditableSection
            title="Utilities"
            property={property}
            onSave={saveFields}
            fields={[
              { key: 'gas_supplier', label: 'Gas Supplier', type: 'text' },
              { key: 'electric_supplier', label: 'Electric Supplier', type: 'text' },
              { key: 'water_supplier', label: 'Water Supplier', type: 'text' },
              { key: 'wifi_provider', label: 'WiFi Provider', type: 'text' },
              { key: 'wifi_account', label: 'WiFi Account', type: 'text' },
              { key: 'wifi_payment_method', label: 'WiFi Payment Method', type: 'text' },
              { key: 'wifi_start_date', label: 'WiFi Start Date', type: 'date' },
            ]}
          />

          <EditableSection
            title="Location"
            property={property}
            onSave={saveFields}
            fields={[
              { key: 'maps_link', label: 'Google Maps Link', type: 'text' },
              { key: 'coordinates', label: 'Coordinates (lat, long)', type: 'text' },
            ]}
          />
        </>
      )}
    </div>
  )
}
