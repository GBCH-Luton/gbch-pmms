// Assets tab of the Property Profile. See scripts/add_property_assets_table.sql
// for the pmms.property_assets table this component depends on -- run it
// before using this tab. Asset photos reuse the 'property-docs' bucket
// already created by add_property_compliance_table.sql.
//
// CREATE TABLE pmms.property_assets (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   property_id uuid REFERENCES pmms.properties(id) ON DELETE CASCADE,
//   asset_name text NOT NULL,
//   asset_category text,
//   make text,
//   model text,
//   serial_number text,
//   installation_date date,
//   warranty_start date,
//   warranty_end date,
//   lifespan_years integer,
//   current_status text DEFAULT 'Operational',
//   maintenance_frequency text,
//   last_service_date date,
//   current_value numeric,
//   supplier_details text,
//   asset_photo_url text,
//   notes text,
//   created_at timestamptz DEFAULT now()
// );

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, formatUKDate,
} from './shared'
import { compressImage } from '../../lib/imageCompression'

const ASSET_CATEGORIES = ['Boiler', 'Fire Alarm', 'Electrical Panel', 'Lift', 'Hot Water Tank', 'Ventilation', 'Plumbing', 'Door Entry', 'CCTV', 'Other']
const CURRENT_STATUSES = ['Operational', 'Needs Repair', 'End of Life']
const MAINTENANCE_FREQUENCIES = ['Annual', '6-Monthly', 'Monthly', 'As Required']

const STATUS_STYLES = {
  'Operational': { bg: '#dcfce7', color: '#16a34a' },
  'Needs Repair': { bg: '#fef3c7', color: '#d97706' },
  'End of Life': { bg: '#fee2e2', color: '#dc2626' },
}

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

function computeNextService(lastServiceDate, frequency) {
  if (!lastServiceDate) return null
  const days = frequency === 'Annual' ? 365 : frequency === '6-Monthly' ? 183 : frequency === 'Monthly' ? 30 : null
  if (days == null) return null
  const d = new Date(lastServiceDate)
  d.setDate(d.getDate() + days)
  return d
}

function considerReplace(installationDate, lifespanYears) {
  if (!installationDate || !lifespanYears) return false
  const ageYears = (Date.now() - new Date(installationDate).getTime()) / (365.25 * 86400000)
  return ageYears > lifespanYears
}

const emptyForm = {
  asset_name: '', asset_category: '', make: '', model: '', serial_number: '',
  installation_date: '', warranty_start: '', warranty_end: '', lifespan_years: '',
  current_status: 'Operational', maintenance_frequency: '', last_service_date: '',
  current_value: '', supplier_details: '', notes: '', asset_photo_url: '',
}

function AssetFormModal({ property, asset, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (asset) {
      setForm({
        asset_name: asset.asset_name || '',
        asset_category: asset.asset_category || '',
        make: asset.make || '',
        model: asset.model || '',
        serial_number: asset.serial_number || '',
        installation_date: asset.installation_date || '',
        warranty_start: asset.warranty_start || '',
        warranty_end: asset.warranty_end || '',
        lifespan_years: asset.lifespan_years ?? '',
        current_status: asset.current_status || 'Operational',
        maintenance_frequency: asset.maintenance_frequency || '',
        last_service_date: asset.last_service_date || '',
        current_value: asset.current_value ?? '',
        supplier_details: asset.supplier_details || '',
        notes: asset.notes || '',
        asset_photo_url: asset.asset_photo_url || '',
      })
    } else {
      setForm(emptyForm)
    }
    setError('')
    setConfirmingDelete(false)
  }, [asset])

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError('')
    const compressed = await compressImage(file)
    const path = `${property.id}/assets/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('property-docs').upload(path, compressed)
    setUploading(false)

    if (uploadError) { setError(`Photo upload failed: ${uploadError.message}`); return }

    const url = supabase.storage.from('property-docs').getPublicUrl(path).data.publicUrl
    set('asset_photo_url', url)
  }

  async function handleSave() {
    setError('')
    if (!form.asset_name.trim()) { setError('Asset Name is required.'); return }

    setSaving(true)

    const payload = {
      property_id: property.id,
      asset_name: form.asset_name.trim(),
      asset_category: form.asset_category || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      installation_date: form.installation_date || null,
      warranty_start: form.warranty_start || null,
      warranty_end: form.warranty_end || null,
      lifespan_years: form.lifespan_years === '' ? null : Number(form.lifespan_years),
      current_status: form.current_status,
      maintenance_frequency: form.maintenance_frequency || null,
      last_service_date: form.last_service_date || null,
      current_value: form.current_value === '' ? null : Number(form.current_value),
      supplier_details: form.supplier_details.trim() || null,
      notes: form.notes.trim() || null,
      asset_photo_url: form.asset_photo_url || null,
    }

    let result
    if (asset) {
      result = await supabase.schema('pmms').from('property_assets').update(payload).eq('id', asset.id).select().single()
    } else {
      result = await supabase.schema('pmms').from('property_assets').insert(payload).select().single()
    }

    setSaving(false)

    if (result.error) { setError(result.error.message); return }

    onSaved(result.data)
  }

  async function handleDelete() {
    setDeleting(true)
    const { error: deleteError } = await supabase.schema('pmms').from('property_assets').delete().eq('id', asset.id)
    setDeleting(false)

    if (deleteError) { setError(deleteError.message); return }

    onDeleted(asset.id)
  }

  const nextService = computeNextService(form.last_service_date, form.maintenance_frequency)
  const warrantyToday = new Date()
  warrantyToday.setHours(0, 0, 0, 0)

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '620px' }}>
        <p style={modalTitleStyle}>{asset ? 'Edit Asset' : 'Add Asset'}</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div>
            <p style={modalLabelStyle}>Asset Name</p>
            <input type="text" value={form.asset_name} onChange={(e) => set('asset_name', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <p style={modalLabelStyle}>Category</p>
            <select value={form.asset_category} onChange={(e) => set('asset_category', e.target.value)} style={inputStyle}>
              <option value="">Select...</option>
              {ASSET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <p style={modalLabelStyle}>Make</p>
            <input type="text" value={form.make} onChange={(e) => set('make', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <p style={modalLabelStyle}>Model</p>
            <input type="text" value={form.model} onChange={(e) => set('model', e.target.value)} style={inputStyle} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <p style={modalLabelStyle}>Serial Number</p>
            <input type="text" value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} style={inputStyle} />
          </div>

          <div>
            <p style={modalLabelStyle}>Installation Date</p>
            <input type="date" value={form.installation_date} onChange={(e) => set('installation_date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <p style={modalLabelStyle}>Lifespan Threshold (years)</p>
            <input type="number" value={form.lifespan_years} onChange={(e) => set('lifespan_years', e.target.value)} style={inputStyle} />
          </div>

          <div>
            <p style={modalLabelStyle}>Warranty Start Date</p>
            <input type="date" value={form.warranty_start} onChange={(e) => set('warranty_start', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <p style={modalLabelStyle}>Warranty End Date</p>
            <input type="date" value={form.warranty_end} onChange={(e) => set('warranty_end', e.target.value)} style={inputStyle} />
            {form.warranty_end && (
              <span style={{
                display: 'inline-block', marginTop: '6px', fontSize: '10px', fontWeight: 800, padding: '2px 10px', borderRadius: '20px',
                color: new Date(form.warranty_end) >= warrantyToday ? '#16a34a' : '#dc2626',
                background: new Date(form.warranty_end) >= warrantyToday ? '#dcfce7' : '#fee2e2',
              }}>
                {new Date(form.warranty_end) >= warrantyToday ? 'In Warranty' : 'Expired'}
              </span>
            )}
          </div>

          <div>
            <p style={modalLabelStyle}>Current Status</p>
            <select value={form.current_status} onChange={(e) => set('current_status', e.target.value)} style={inputStyle}>
              {CURRENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <p style={modalLabelStyle}>Maintenance Frequency</p>
            <select value={form.maintenance_frequency} onChange={(e) => set('maintenance_frequency', e.target.value)} style={inputStyle}>
              <option value="">Select...</option>
              {MAINTENANCE_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div>
            <p style={modalLabelStyle}>Last Service Date</p>
            <input type="date" value={form.last_service_date} onChange={(e) => set('last_service_date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <p style={modalLabelStyle}>Next Service Date</p>
            <input type="text" readOnly value={nextService ? formatUKDate(nextService.toISOString()) : '—'} style={{ ...inputStyle, background: '#f8fafc', color: '#64748b' }} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <p style={modalLabelStyle}>Current Value (£)</p>
            <input type="number" value={form.current_value} onChange={(e) => set('current_value', e.target.value)} style={inputStyle} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <p style={modalLabelStyle}>Supplier Details</p>
            <textarea value={form.supplier_details} onChange={(e) => set('supplier_details', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <p style={modalLabelStyle}>Notes</p>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <p style={modalLabelStyle}>Asset Photo</p>
            {form.asset_photo_url && (
              <img src={form.asset_photo_url} alt="Asset" style={{ width: '100%', maxHeight: '180px', objectFit: 'cover', borderRadius: '10px', display: 'block', marginBottom: '8px' }} />
            )}
            <input type="file" accept="image/*" id="asset-photo-input" onChange={handlePhoto} style={{ display: 'none' }} />
            <button
              onClick={() => document.getElementById('asset-photo-input').click()}
              disabled={uploading}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}
            >
              {uploading ? 'Uploading...' : form.asset_photo_url ? 'Change photo' : 'Upload photo'}
            </button>
          </div>
        </div>

        {error && <p style={modalErrorStyle}>{error}</p>}

        {confirmingDelete ? (
          <div style={{ marginTop: '16px', padding: '14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 700, color: '#7f1d1d' }}>Delete this asset? This cannot be undone.</p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setConfirmingDelete(false)} style={modalCancelBtnStyle}>Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{ flex: 2, padding: '10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? 'Deleting...' : 'Delete Asset'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
            {asset && (
              <button
                onClick={() => setConfirmingDelete(true)}
                style={{ padding: '10px 16px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                Delete
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ ...modalConfirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving...' : asset ? 'Save changes' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function AssetCard({ asset, onOpen }) {
  const nextService = computeNextService(asset.last_service_date, asset.maintenance_frequency)
  const replace = considerReplace(asset.installation_date, asset.lifespan_years)
  const statusStyle = STATUS_STYLES[asset.current_status] || STATUS_STYLES['Operational']

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{asset.asset_name}</p>
        <span style={{ fontSize: '11px', fontWeight: 800, color: statusStyle.color, background: statusStyle.bg, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
          {asset.current_status || 'Operational'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {asset.asset_category && (
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#1d4ed8', background: '#dbeafe', padding: '2px 8px', borderRadius: '20px' }}>{asset.asset_category}</span>
        )}
        {replace && (
          <span style={{ fontSize: '10px', fontWeight: 800, color: '#c2410c', background: '#ffedd5', padding: '2px 8px', borderRadius: '20px' }}>⚠ Consider Replace</span>
        )}
      </div>

      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
        Last service: <strong style={{ color: '#0f172a' }}>{asset.last_service_date ? formatUKDate(asset.last_service_date) : '—'}</strong>
      </div>
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '14px' }}>
        Next service: <strong style={{ color: '#0f172a' }}>{nextService ? formatUKDate(nextService.toISOString()) : '—'}</strong>
      </div>

      <button
        onClick={() => onOpen(asset)}
        style={{ width: '100%', padding: '9px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
      >
        View / Edit
      </button>
    </div>
  )
}

export default function PropertyAssetsTab({ property }) {
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modalAsset, setModalAsset] = useState(undefined) // undefined = closed, null = add, object = edit

  useEffect(() => {
    fetchAssets()
  }, [property.id])

  async function fetchAssets() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_assets')
      .select('*')
      .eq('property_id', property.id)
      .order('asset_name')

    if (error) {
      setAssets([])
      setLoadError(error.message)
      setLoading(false)
      return
    }

    setAssets(data || [])
    setLoading(false)
  }

  function handleSaved(saved) {
    setAssets(prev => {
      const exists = prev.some(a => a.id === saved.id)
      return exists ? prev.map(a => a.id === saved.id ? saved : a) : [...prev, saved].sort((a, b) => a.asset_name.localeCompare(b.asset_name))
    })
    setModalAsset(undefined)
  }

  function handleDeleted(id) {
    setAssets(prev => prev.filter(a => a.id !== id))
    setModalAsset(undefined)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8', fontWeight: 600 }}>Loading assets...</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Assets ({assets.length})
        </p>
        <button
          onClick={() => setModalAsset(null)}
          style={{ padding: '10px 18px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          ＋ Add Asset
        </button>
      </div>

      {loadError ? (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>Couldn't load assets</p>
          <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d', fontFamily: 'monospace' }}>{loadError}</p>
        </div>
      ) : assets.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8', fontStyle: 'italic' }}>No assets recorded for this property yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
          {assets.map(asset => (
            <AssetCard key={asset.id} asset={asset} onOpen={setModalAsset} />
          ))}
        </div>
      )}

      {modalAsset !== undefined && (
        <AssetFormModal
          property={property}
          asset={modalAsset}
          onClose={() => setModalAsset(undefined)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
