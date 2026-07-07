// Compliance tab of the Property Profile. See
// scripts/add_property_compliance_table.sql for the pmms.property_compliance
// table + 'property-docs' storage bucket this component depends on -- run it
// before using this tab.
//
// CREATE TABLE pmms.property_compliance (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
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
import { modalLabelStyle, modalErrorStyle, formatUKDate } from './shared'

const COMPLIANCE_TYPES = [
  { key: 'gas_safety', title: 'Gas Safety (CP12)' },
  { key: 'electrical_safety', title: 'Electrical Safety (EICR)' },
  { key: 'pat_testing', title: 'PAT Testing' },
  { key: 'fire_risk_assessment', title: 'Fire Risk Assessment' },
  { key: 'fire_alarm_test_log', title: 'Fire Alarm Test Log' },
  { key: 'fire_extinguisher_check', title: 'Fire Extinguisher Check', dateLabel: 'Next Due Date' },
  { key: 'fire_extinguisher_service', title: 'Fire Extinguisher Service' },
  { key: 'legionella_risk_assessment', title: 'Legionella Risk Assessment' },
  { key: 'asbestos_management', title: 'Asbestos Management' },
  { key: 'lift_safety', title: 'Lift Safety' },
  { key: 'health_safety_inspection', title: 'Health & Safety Inspection' },
]

const RAG_STYLES = {
  green: { bg: '#dcfce7', color: '#16a34a' },
  amber: { bg: '#fef3c7', color: '#d97706' },
  red: { bg: '#fee2e2', color: '#dc2626' },
  grey: { bg: '#f1f5f9', color: '#64748b' },
}

function computeRag(record) {
  if (!record) return { tier: 'red', label: 'No Record' }
  if (record.not_applicable) return { tier: 'grey', label: 'N/A' }
  if (!record.expiry_date) return { tier: 'red', label: 'No Record' }

  const expiry = new Date(record.expiry_date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.floor((expiry - today) / 86400000)

  if (daysLeft < 0) return { tier: 'red', label: 'Expired' }
  if (daysLeft <= 90) return { tier: 'amber', label: `Due in ${daysLeft}d` }
  return { tier: 'green', label: 'Valid' }
}

function RagPill({ tier, label }) {
  const style = RAG_STYLES[tier]
  return (
    <span style={{ fontSize: '11px', fontWeight: 800, color: style.color, background: style.bg, padding: '4px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

function ComplianceCard({ type, record, onUpload, onSave }) {
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

  const rag = computeRag(record)
  const inputId = `compliance-file-${type.key}`

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>{type.title}</p>
        <RagPill tier={rag.tier} label={rag.label} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer' }}>
        <input type="checkbox" checked={notApplicable} onChange={(e) => markDirty(setNotApplicable)(e.target.checked)} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>Not applicable to this property</span>
      </label>

      {!notApplicable && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div style={{ flex: '1 1 180px' }}>
            <p style={modalLabelStyle}>{type.dateLabel || 'Expiry Date'}</p>
            <input
              type="date"
              value={expiryDate || ''}
              onChange={(e) => markDirty(setExpiryDate)(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ flex: '1 1 180px' }}>
            <p style={modalLabelStyle}>Certificate</p>
            <input type="file" accept=".pdf,image/*" id={inputId} onChange={handleFilePick} style={{ display: 'none' }} />
            <button
              onClick={() => document.getElementById(inputId).click()}
              disabled={uploading}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}
            >
              {uploading ? 'Uploading...' : 'Upload Certificate'}
            </button>
            {record?.cert_url && (
              <a href={record.cert_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '6px', fontSize: '12px', fontWeight: 700, color: '#1d4ed8' }}>
                View current certificate ↗
              </a>
            )}
          </div>
        </div>
      )}

      <p style={modalLabelStyle}>Notes</p>
      <textarea
        value={notes}
        onChange={(e) => markDirty(setNotes)(e.target.value)}
        rows={2}
        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
      />

      {error && <p style={modalErrorStyle}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          {record?.updated_at ? `Last updated ${formatUKDate(record.updated_at)}` : 'Never updated'}
        </span>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            padding: '8px 20px', background: dirty ? '#16a34a' : '#e2e8f0', color: dirty ? '#fff' : '#94a3b8',
            border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: (saving || !dirty) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export default function PropertyComplianceTab({ property }) {
  const [records, setRecords] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    fetchCompliance()
  }, [property.id])

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
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_compliance')
      .upsert(
        { property_id: property.id, cert_type: certType, updated_at: new Date().toISOString(), ...fields },
        { onConflict: 'property_id,cert_type' }
      )
      .select()
      .single()

    if (error) return error.message

    setRecords(prev => ({ ...prev, [certType]: data }))
    return null
  }

  async function handleUpload(certType, file) {
    const path = `${property.id}/${certType}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('property-docs').upload(path, file)
    if (uploadError) return `Upload failed: ${uploadError.message}`

    const certUrl = supabase.storage.from('property-docs').getPublicUrl(path).data.publicUrl
    return upsertRecord(certType, { cert_url: certUrl })
  }

  if (loading) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8', fontWeight: 600 }}>Loading compliance records...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>Couldn't load compliance records</p>
        <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d', fontFamily: 'monospace' }}>{loadError}</p>
      </div>
    )
  }

  return (
    <div>
      {/* RAG dashboard */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Compliance Overview</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {COMPLIANCE_TYPES.map(type => {
            const rag = computeRag(records[type.key])
            return (
              <div key={type.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: RAG_STYLES[rag.tier].color, flexShrink: 0 }} />
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>{type.title}</span>
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
        />
      ))}
    </div>
  )
}
