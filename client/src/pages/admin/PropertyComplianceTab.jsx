// Compliance tab of the Property Profile. See
// scripts/add_property_compliance_table.sql for the pmms.property_compliance
// table + 'property-docs' storage bucket this component depends on -- run it
// before using this tab.
//
// CREATE TABLE pmms.property_compliance (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   property_id uuid REFERENCES pmms.properties(id) ON DELETE CASCADE,
//   cert_type text NOT NULL,
//   expiry_date date,
//   cert_url text,
//   notes text,
//   not_applicable boolean NOT NULL DEFAULT false, -- powers the Grey "N/A" RAG state (e.g. Lift Safety on a property with no lift)
//   updated_at timestamptz DEFAULT now(),
//   UNIQUE(property_id, cert_type)
// );

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { modalLabelStyle, modalErrorStyle, formatUKDate, COMPLIANCE_TYPES, RAG_STYLES, RagPill, computeComplianceAging } from './shared'
import { compressImage } from '../../lib/imageCompression'
import { getSignedUrl } from '../../lib/storage'

function ComplianceCard({ type, record, onUpload, onSave, thresholdDays, readOnly = false }) {
  const [expiryDate, setExpiryDate] = useState(record?.expiry_date || '')
  const [notes, setNotes] = useState(record?.notes || '')
  const [notApplicable, setNotApplicable] = useState(!!record?.not_applicable)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setExpiryDate(record?.expiry_date || '')
    setNotes(record?.notes || '')
    setNotApplicable(!!record?.not_applicable)
    setDirty(false)
  }, [record])

  function markDirty(setter) {
    return (v) => { setter(v); setDirty(true) }
  }

  async function handleFilePick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    const err = await onUpload(type.key, file)
    setUploading(false)
    if (err) setError(err)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const err = await onSave(type.key, {
      expiry_date: notApplicable ? null : (expiryDate || null),
      notes: notes || null,
      not_applicable: notApplicable,
    })
    setSaving(false)
    if (err) { setError(err); return }
    setDirty(false)
  }

  const rag = computeComplianceAging(record, thresholdDays)
  const inputId = `compliance-file-${type.key}`

  return (
    <div style={{ background: COLORS.white, borderRadius: '16px', padding: '18px 20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>{type.title}</p>
        <RagPill tier={rag.tier} label={rag.label} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: readOnly ? 'default' : 'pointer' }}>
        <input type="checkbox" checked={notApplicable} disabled={readOnly} onChange={(e) => markDirty(setNotApplicable)(e.target.checked)} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.slate500 }}>Not applicable to this property</span>
      </label>

      {!notApplicable && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div style={{ flex: '1 1 180px' }}>
            <p style={modalLabelStyle}>{type.dateLabel || 'Expiry Date'}</p>
            <input
              type="date"
              value={expiryDate || ''}
              disabled={readOnly}
              onChange={(e) => markDirty(setExpiryDate)(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', background: readOnly ? COLORS.slate50 : COLORS.white }}
            />
          </div>

          <div style={{ flex: '1 1 180px' }}>
            <p style={modalLabelStyle}>Certificate</p>
            {!readOnly && (
              <>
                <input type="file" accept=".pdf,image/*" id={inputId} onChange={handleFilePick} style={{ display: 'none' }} />
                <button
                  onClick={() => document.getElementById(inputId).click()}
                  disabled={uploading}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `2px dashed ${COLORS.slate300}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}
                >
                  {uploading ? 'Uploading...' : 'Upload Certificate'}
                </button>
              </>
            )}
            {record?.cert_url && (
              <a href={record.cert_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '6px', fontSize: '12px', fontWeight: 700, color: COLORS.blue700 }}>
                View current certificate ↗
              </a>
            )}
          </div>
        </div>
      )}

      <p style={modalLabelStyle}>Notes</p>
      <textarea
        value={notes}
        disabled={readOnly}
        onChange={(e) => markDirty(setNotes)(e.target.value)}
        rows={2}
        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', background: readOnly ? COLORS.slate50 : COLORS.white }}
      />

      {error && <p style={modalErrorStyle}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
        <span style={{ fontSize: '11px', color: COLORS.slate400 }}>
          {record?.updated_at ? `Last updated ${formatUKDate(record.updated_at)}` : 'Never updated'}
        </span>
        {!readOnly && (
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{
              padding: '8px 20px', background: dirty ? COLORS.green600 : COLORS.slate200, color: dirty ? COLORS.white : COLORS.slate400,
              border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: (saving || !dirty) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}

export default function PropertyComplianceTab({ property, profile }) {
  const readOnly = profile?.division === 'Landlord Liaison'
  const [records, setRecords] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [thresholdDays, setThresholdDays] = useState(90)

  useEffect(() => {
    fetchCompliance()
    fetchThreshold()
  }, [property.id])

  async function fetchThreshold() {
    const { data } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'compliance_aging_threshold_days')
      .maybeSingle()
    if (data?.setting_value != null) setThresholdDays(Number(data.setting_value))
  }

  async function fetchCompliance() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_compliance')
      .select('*')
      .eq('property_id', property.id)

    if (error) {
      setRecords({})
      setLoadError(error.message)
      setLoading(false)
      return
    }

    const map = {}
    ;(data || []).forEach(row => { map[row.cert_type] = row })
    setRecords(map)
    setLoading(false)
  }

  async function upsertRecord(certType, fields) {
    // Renewing a cert (a new expiry_date) must re-arm the daily aging-check
    // job -- otherwise a cert that already triggered one alert would stay
    // silently un-eligible forever even after it expires again years later.
    const previousExpiry = records[certType]?.expiry_date || null
    const expiryChanged = 'expiry_date' in fields && fields.expiry_date !== previousExpiry

    const { data, error } = await supabase
      .schema('pmms')
      .from('property_compliance')
      .upsert(
        {
          property_id: property.id, cert_type: certType, updated_at: new Date().toISOString(),
          ...(expiryChanged ? { aging_alert_sent_at: null } : {}), ...fields,
        },
        { onConflict: 'property_id,cert_type' }
      )
      .select()
      .single()

    if (error) return error.message

    setRecords(prev => ({ ...prev, [certType]: data }))
    return null
  }

  async function handleUpload(certType, file) {
    // compressImage() is a no-op pass-through for PDFs -- certs can be
    // either a scanned PDF or a photo, per the input's accept attr.
    const compressed = await compressImage(file)
    const path = `${property.id}/${certType}/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('property-docs').upload(path, compressed)
    if (uploadError) return `Upload failed: ${uploadError.message}`

    const certUrl = await getSignedUrl('property-docs', path)
    return upsertRecord(certType, { cert_url: certUrl })
  }

  if (loading) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading compliance records...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load compliance records</p>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{loadError}</p>
      </div>
    )
  }

  return (
    <div>
      {/* RAG dashboard */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '18px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Compliance Overview</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {COMPLIANCE_TYPES.map(type => {
            const rag = computeComplianceAging(records[type.key], thresholdDays)
            return (
              <div key={type.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '10px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}` }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: RAG_STYLES[rag.tier].color, flexShrink: 0 }} />
                <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate900, whiteSpace: 'nowrap' }}>{type.title}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Cards */}
      {COMPLIANCE_TYPES.map(type => (
        <ComplianceCard
          key={type.key}
          type={type}
          record={records[type.key]}
          onUpload={handleUpload}
          onSave={upsertRecord}
          thresholdDays={thresholdDays}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}
