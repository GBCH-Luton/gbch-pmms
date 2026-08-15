// Lease & Legal tab of the Property Profile. See
// scripts/add_property_lease_legal_columns.sql for the pmms.properties
// columns this component depends on -- run it before using this tab.
// Lease/insurance documents reuse the 'property-docs' bucket already
// created by add_property_compliance_table.sql.
//
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS lease_start_date date;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS lease_end_date date;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS lease_type text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS lease_status text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS landlord_company text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS landlord_name text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS landlord_phone text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS landlord_email text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS rent_amount numeric;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS rent_payment_day integer;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS deposit_amount numeric;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS deposit_scheme text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS deposit_scheme_id text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS special_lease_terms text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS insurance_expiry date;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS insurance_doc_url text;
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS lease_doc_url text;

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { modalLabelStyle, modalErrorStyle } from './shared'
import { compressImage } from '../../lib/imageCompression'
import { getSignedUrl } from '../../lib/storage'

const LEASE_TYPES = ['Fixed Term', 'Rolling', 'Assured Shorthold', 'Other']
const LEASE_STATUSES = ['Active', 'Expiring', 'Renewed', 'Terminated']
const DEPOSIT_SCHEMES = ['DPS', 'TDS', 'MyDeposits', 'None']

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }
const readRowStyle = { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: `1px solid ${COLORS.slate100}` }
const readLabelStyle = { fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }
const readValueStyle = { fontSize: '13px', fontWeight: 600, color: COLORS.slate900, textAlign: 'right' }

function daysBetween(dateStr) {
  const target = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.floor((target - today) / 86400000)
}

function filenameFromUrl(url) {
  if (!url) return ''
  const last = url.split('/').pop() || url
  const decoded = decodeURIComponent(last)
  return decoded.replace(/^\d+-/, '')
}

function leaseBanner(leaseEndDate) {
  if (!leaseEndDate) return { tier: 'grey', label: 'No lease end date set' }
  const daysLeft = daysBetween(leaseEndDate)
  if (daysLeft <= 30) return { tier: 'red', label: 'Lease Expires Soon / Expired' }
  if (daysLeft <= 180) return { tier: 'amber', label: `Lease Expiring — ${daysLeft} days remaining` }
  return { tier: 'green', label: 'Lease Active' }
}

function insuranceBadge(expiry) {
  if (!expiry) return null
  const daysLeft = daysBetween(expiry)
  if (daysLeft < 0) return { tier: 'red', label: 'Expired' }
  if (daysLeft <= 90) return { tier: 'amber', label: `Expires in ${daysLeft}d` }
  return { tier: 'green', label: 'Valid' }
}

const BADGE_STYLES = {
  green: { bg: COLORS.green100, color: COLORS.green600 },
  amber: { bg: COLORS.amber100, color: COLORS.amber600 },
  red: { bg: COLORS.red100, color: COLORS.red600 },
  grey: { bg: COLORS.slate100, color: COLORS.slate500 },
}

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
      <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
    )
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      min={field.min}
      max={field.max}
      style={inputStyle}
    />
  )
}

function formatReadValue(field, value) {
  if (value === null || value === undefined || value === '') return '—'
  if (field.key === 'landlord_email') {
    return <a href={`mailto:${value}`} style={{ color: COLORS.blue700, fontWeight: 700 }}>{value}</a>
  }
  if (field.key === 'rent_amount' || field.key === 'deposit_amount') {
    return `£${Number(value).toLocaleString()}`
  }
  return String(value)
}

function EditableSection({ title, fields, property, onSave, extra, readOnly = false }) {
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
    <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>{title}</p>
        {!editing && !readOnly && (
          <button
            onClick={startEdit}
            style={{ padding: '6px 14px', background: COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
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
          {extra}
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
            <button onClick={() => setEditing(false)} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{ flex: 2, padding: '10px', background: COLORS.green600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DocUpload({ label, urlKey, property, onSave, bucketFolder, readOnly = false }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputId = `doc-upload-${urlKey}`

  async function handlePick(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError('')
    // compressImage() is a no-op pass-through for PDFs -- lease/legal docs
    // can be either a scanned PDF or a photo, per the input's accept attr.
    const compressed = await compressImage(file)
    const path = `${property.id}/${bucketFolder}/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('property-docs').upload(path, compressed)

    if (uploadError) {
      setUploading(false)
      setError(`Upload failed: ${uploadError.message}`)
      return
    }

    const url = await getSignedUrl('property-docs', path)
    const err = await onSave({ [urlKey]: url })
    setUploading(false)
    if (err) setError(err)
  }

  const existingUrl = property[urlKey]

  return (
    <div style={{ marginTop: '4px' }}>
      <p style={modalLabelStyle}>{label}</p>
      {existingUrl && (
        <a href={existingUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 700, color: COLORS.blue700 }}>
          📄 {filenameFromUrl(existingUrl)} — Download ↗
        </a>
      )}
      {!readOnly && (
        <>
          <input type="file" accept=".pdf,image/*" id={inputId} onChange={handlePick} style={{ display: 'none' }} />
          <button
            onClick={() => document.getElementById(inputId).click()}
            disabled={uploading}
            style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `2px dashed ${COLORS.slate300}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}
          >
            {uploading ? 'Uploading...' : existingUrl ? 'Replace document' : 'Upload document'}
          </button>
        </>
      )}
      {error && <p style={modalErrorStyle}>{error}</p>}
    </div>
  )
}

export default function PropertyLeaseLegalTab({ property, onFieldsSaved, profile }) {
  const readOnly = profile?.division === 'Landlord Liaison'

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

  const banner = leaseBanner(property.lease_end_date)
  const bannerStyle = BADGE_STYLES[banner.tier]

  const insBadge = insuranceBadge(property.insurance_expiry)
  const insBadgeStyle = insBadge ? BADGE_STYLES[insBadge.tier] : null

  return (
    <div>
      {/* Lease status banner */}
      <div style={{ background: bannerStyle.bg, border: `1px solid ${bannerStyle.color}33`, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: bannerStyle.color }}>{banner.tier === 'grey' ? '—' : '●'} {banner.label}</p>
      </div>

      <EditableSection
        title="Lease Details"
        property={property}
        onSave={saveFields}
        readOnly={readOnly}
        fields={[
          { key: 'lease_start_date', label: 'Lease Start Date', type: 'date' },
          { key: 'lease_end_date', label: 'Lease End Date', type: 'date' },
          { key: 'lease_type', label: 'Lease Type', type: 'select', options: LEASE_TYPES },
          { key: 'lease_status', label: 'Lease Status', type: 'select', options: LEASE_STATUSES },
          { key: 'special_lease_terms', label: 'Special Lease Terms', type: 'textarea' },
        ]}
        extra={
          <DocUpload label="Lease Agreement Document" urlKey="lease_doc_url" bucketFolder="lease" property={property} onSave={saveFields} readOnly={readOnly} />
        }
      />

      <EditableSection
        title="Landlord Details"
        property={property}
        onSave={saveFields}
        readOnly={readOnly}
        fields={[
          { key: 'landlord_company', label: 'Landlord Company Name', type: 'text' },
          { key: 'landlord_name', label: 'Landlord Contact Name', type: 'text' },
          { key: 'landlord_phone', label: 'Landlord Phone', type: 'text' },
          { key: 'landlord_email', label: 'Landlord Email', type: 'text' },
        ]}
      />

      <EditableSection
        title="Financials"
        property={property}
        onSave={saveFields}
        readOnly={readOnly}
        fields={[
          { key: 'rent_amount', label: 'Weekly Rent Amount (£)', type: 'number' },
          { key: 'rent_payment_day', label: 'Rent Payment Day (1–31)', type: 'number', min: 1, max: 31 },
          { key: 'deposit_amount', label: 'Deposit Amount (£)', type: 'number' },
          { key: 'deposit_scheme', label: 'Deposit Protection Scheme', type: 'select', options: DEPOSIT_SCHEMES },
          { key: 'deposit_scheme_id', label: 'Deposit Scheme Reference ID', type: 'text' },
        ]}
      />

      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>Insurance</p>
          {insBadge && (
            <span style={{ fontSize: '11px', fontWeight: 800, color: insBadgeStyle.color, background: insBadgeStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>
              {insBadge.label}
            </span>
          )}
        </div>
        <InsuranceSection property={property} onSave={saveFields} readOnly={readOnly} />
      </div>
    </div>
  )
}

function InsuranceSection({ property, onSave, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [expiry, setExpiry] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setExpiry(property.insurance_expiry || '')
    setError('')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError('')
    const err = await onSave({ insurance_expiry: expiry || null })
    setSaving(false)
    if (err) { setError(err); return }
    setEditing(false)
  }

  return (
    <div>
      {!editing ? (
        <div style={readRowStyle}>
          <span style={readLabelStyle}>Insurance Expiry Date</span>
          <span style={readValueStyle}>{property.insurance_expiry || '—'}</span>
        </div>
      ) : (
        <div>
          <p style={modalLabelStyle}>Insurance Expiry Date</p>
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle} />
        </div>
      )}

      <DocUpload label="Insurance Policy Document" urlKey="insurance_doc_url" bucketFolder="insurance" property={property} onSave={onSave} readOnly={readOnly} />

      {error && <p style={modalErrorStyle}>{error}</p>}

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        {!editing ? (
          !readOnly && (
            <button
              onClick={startEdit}
              style={{ padding: '6px 14px', background: COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >
              Edit
            </button>
          )
        ) : (
          <>
            <button onClick={() => setEditing(false)} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{ flex: 2, padding: '10px', background: COLORS.green600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
