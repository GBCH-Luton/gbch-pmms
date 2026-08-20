// Property Profile "Inventory" tab -- tracks furniture/appliances in a
// property, split Company-owned vs Landlord-owned. Previewed first as a
// Claude Artifact simulation (a directors' mockup) before being built for
// real here -- card layout, owner sub-tabs, and the add/edit modal all
// mirror that design closely. See scripts/add_property_inventory_items.sql
// for the table this depends on.
//
// Same admin/manager-full-access RLS as every other Property Profile tab
// (real per-division DB restriction is parked, see property_status_history's
// own comment) -- readOnly here is a client-side-only gate, same pattern as
// PropertyGardensTab.jsx.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import {
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalSubtitleStyle,
  modalLabelStyle, modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle, formatUKDate,
} from './shared'
import { compressImage } from '../../lib/imageCompression'
import { getSignedUrl } from '../../lib/storage'

const CATEGORY_OPTIONS = ['Seating', 'Table', 'Appliance', 'Bed / Bedroom', 'Storage', 'Other']
const ROOM_OPTIONS = ['Living Room', 'Kitchen', 'Bedroom 1', 'Bedroom 2', 'Communal Area']
const CONDITION_STYLES = {
  good: COLORS.green600,
  fair: COLORS.amber600,
  poor: COLORS.red600,
}

const CATEGORY_ICON_PATHS = {
  'Seating': 'M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4 M4 11h16v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z M5 17v3M19 17v3',
  'Table': 'M3 8h18M6 8v12M18 8v12',
  'Appliance': 'M9 6h.01M9 11h6',
  'Bed / Bedroom': 'M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6 M3 18v2M21 18v2M3 12V8a2 2 0 0 1 2-2h3v6',
  'Storage': 'M4 12h16M9 3v18M9 7h0M9 16h0',
  'Other': 'M12 8v4l3 2',
}

function CategoryIcon({ category, size = 30 }) {
  const path = CATEGORY_ICON_PATHS[category] || CATEGORY_ICON_PATHS.Other
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {category === 'Storage' && <rect x="4" y="3" width="16" height="18" rx="1.5" />}
      {category === 'Bed / Bedroom' && <path d="M3 12V8a2 2 0 0 1 2-2h3v6" />}
      {category === 'Appliance' && <rect x="6" y="2" width="12" height="20" rx="1.5" />}
      {category === 'Other' && <circle cx="12" cy="12" r="9" />}
      <path d={path} />
    </svg>
  )
}

const emptyForm = { owner: 'company', name: '', category: CATEGORY_OPTIONS[0], room: ROOM_OPTIONS[0], condition: 'good', notes: '', photoUrl: '' }

export default function PropertyInventoryTab({ property, profile }) {
  const readOnly = profile?.division === 'Landlord Liaison'
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [activeOwner, setActiveOwner] = useState('company')
  const [openMenuId, setOpenMenuId] = useState(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchItems() }, [property.id])

  async function fetchItems() {
    setLoading(true)
    setLoadError('')
    const { data, error: fetchError } = await supabase
      .schema('pmms')
      .from('property_inventory_items')
      .select('*')
      .eq('property_id', property.id)
      .order('created_at', { ascending: false })

    if (fetchError) setLoadError(fetchError.message)
    else setItems(data || [])
    setLoading(false)
  }

  function openAddModal() {
    setEditingId(null)
    setForm({ ...emptyForm, owner: activeOwner })
    setError('')
    setModalOpen(true)
  }

  function openEditModal(item) {
    setOpenMenuId(null)
    setEditingId(item.id)
    setForm({
      owner: item.owner, name: item.name, category: item.category || CATEGORY_OPTIONS[0],
      room: item.room || ROOM_OPTIONS[0], condition: item.condition || 'good',
      notes: item.notes || '', photoUrl: item.photo_url || '',
    })
    setError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoUploading(true)
    setError('')

    let compressed
    try {
      compressed = await compressImage(file)
    } catch (compressErr) {
      setPhotoUploading(false)
      setError(compressErr.message)
      return
    }
    const path = `${property.id}/inventory-${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('property-photos').upload(path, compressed)

    if (uploadError) {
      setPhotoUploading(false)
      setError(`Photo upload failed: ${uploadError.message}`)
      return
    }

    const url = await getSignedUrl('property-photos', path)
    setForm(prev => ({ ...prev, photoUrl: url }))
    setPhotoUploading(false)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) return

    setSaving(true)
    setError('')

    const fields = {
      property_id: property.id,
      owner: form.owner,
      name: form.name.trim(),
      category: form.category,
      room: form.room,
      condition: form.condition,
      notes: form.notes.trim() || null,
      photo_url: form.photoUrl || null,
    }

    const { error: saveError } = editingId
      ? await supabase.schema('pmms').from('property_inventory_items').update(fields).eq('id', editingId)
      : await supabase.schema('pmms').from('property_inventory_items').insert(fields)

    setSaving(false)
    if (saveError) { setError(saveError.message); return }

    setActiveOwner(form.owner)
    closeModal()
    fetchItems()
  }

  async function handleDelete(id) {
    setOpenMenuId(null)
    const { error: deleteError } = await supabase.schema('pmms').from('property_inventory_items').delete().eq('id', id)
    if (deleteError) { setLoadError(deleteError.message); return }
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const companyCount = items.filter(i => i.owner === 'company').length
  const landlordCount = items.filter(i => i.owner === 'landlord').length
  const visibleItems = items.filter(i => i.owner === activeOwner)

  const ownerTabBtn = (owner, count) => ({
    appearance: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: 700,
    padding: '8px 16px', borderRadius: '9px', display: 'flex', alignItems: 'center', gap: '8px',
    background: activeOwner === owner ? (owner === 'company' ? COLORS.green100 : COLORS.blue100) : 'transparent',
    color: activeOwner === owner ? (owner === 'company' ? COLORS.green700 : COLORS.blue700) : COLORS.slate500,
  })

  if (loading) {
    return <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}><p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400 }}>Loading...</p></div>
  }

  return (
    <div>
      {loadError && <p style={modalErrorStyle}>{loadError}</p>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'inline-flex', gap: '4px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, padding: '4px', borderRadius: '12px' }}>
          <button onClick={() => setActiveOwner('company')} style={ownerTabBtn('company', companyCount)}>
            Company <span style={{ fontSize: '11px', fontWeight: 800, padding: '1px 7px', borderRadius: '999px', background: 'rgba(0,0,0,0.06)' }}>{companyCount}</span>
          </button>
          <button onClick={() => setActiveOwner('landlord')} style={ownerTabBtn('landlord', landlordCount)}>
            Landlord <span style={{ fontSize: '11px', fontWeight: 800, padding: '1px 7px', borderRadius: '999px', background: 'rgba(0,0,0,0.06)' }}>{landlordCount}</span>
          </button>
        </div>

        {!readOnly && (
          <button
            onClick={openAddModal}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ＋ Add Item
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
        {visibleItems.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 20px', color: COLORS.slate400, fontSize: '13px', fontStyle: 'italic', background: COLORS.white, border: `1px dashed ${COLORS.slate200}`, borderRadius: '14px' }}>
            No {activeOwner} items logged yet for this property.
          </div>
        ) : (
          visibleItems.map(item => (
            <div key={item.id} style={{ position: 'relative', background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column' }}>
              {!readOnly && (
                <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 5 }}>
                  <button
                    onClick={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                    aria-label="Item options"
                    style={{ width: '26px', height: '26px', borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(15,23,42,0.55)', color: COLORS.white, fontSize: '15px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    ⋮
                  </button>
                  {openMenuId === item.id && (
                    <div style={{ position: 'absolute', top: '32px', right: 0, minWidth: '110px', background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', overflow: 'hidden', padding: '4px' }}>
                      <button onClick={() => openEditModal(item)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, color: COLORS.slate900, borderRadius: '7px' }}>Edit</button>
                      <button onClick={() => handleDelete(item.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, color: COLORS.red600, borderRadius: '7px' }}>Delete</button>
                    </div>
                  )}
                </div>
              )}

              <div style={{
                aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: item.photo_url ? 'none' : `linear-gradient(160deg, ${item.owner === 'company' ? COLORS.green50 : COLORS.blue50}, ${COLORS.slate50})`,
                color: item.owner === 'company' ? COLORS.green700 : COLORS.blue700,
              }}>
                {item.photo_url ? <img src={item.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <CategoryIcon category={item.category} />}
              </div>

              <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                <div style={{ fontSize: '13.5px', fontWeight: 800, lineHeight: 1.3 }}>{item.name}</div>
                <div style={{ fontSize: '11.5px', color: COLORS.slate500 }}>{item.category}{item.room ? ` · ${item.room}` : ''}</div>
                {item.notes && <div style={{ fontSize: '11.5px', color: COLORS.slate500, fontStyle: 'italic' }}>{item.notes}</div>}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: COLORS.slate400, borderTop: `1px solid ${COLORS.slate100}`, paddingTop: '8px', marginTop: 'auto' }}>
                  <span>Added {item.created_at ? formatUKDate(item.created_at) : '—'}</span>
                  {item.condition && (
                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: CONDITION_STYLES[item.condition] }}>{item.condition}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {modalOpen && (
        <div style={modalOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>{editingId ? 'Edit Inventory Item' : 'Add Inventory Item'}</p>
            <p style={modalSubtitleStyle}>{property.address}</p>

            <form onSubmit={handleSave}>
              <p style={modalLabelStyle}>Belongs to</p>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['company', 'landlord'].map(o => (
                  <label
                    key={o}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                      border: `1px solid ${form.owner === o ? (o === 'company' ? COLORS.green100 : COLORS.blue100) : COLORS.slate200}`,
                      borderRadius: '9px', padding: '9px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer',
                      background: form.owner === o ? (o === 'company' ? COLORS.green50 : COLORS.blue50) : COLORS.white,
                      color: form.owner === o ? (o === 'company' ? COLORS.green700 : COLORS.blue700) : COLORS.slate500,
                    }}
                  >
                    <input type="radio" name="owner" value={o} checked={form.owner === o} onChange={() => setForm(prev => ({ ...prev, owner: o }))} style={{ width: 'auto', margin: 0 }} />
                    {o === 'company' ? 'Company' : 'Landlord'}
                  </label>
                ))}
              </div>

              <p style={modalLabelStyle}>Item name</p>
              <input
                type="text" required placeholder="e.g. 3-Seater Sofa" value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                style={{ width: '100%', padding: '9px 11px', borderRadius: '9px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />

              <p style={modalLabelStyle}>Photo (optional)</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flexShrink: 0, width: '56px', height: '56px', borderRadius: '10px', overflow: 'hidden', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.slate400 }}>
                  {form.photoUrl ? <img src={form.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📷'}
                </div>
                <input type="file" accept="image/*" id="inventory-photo-input" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                <label
                  htmlFor="inventory-photo-input"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', border: `1px dashed ${COLORS.slate200}`, borderRadius: '10px', padding: '10px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 700, color: COLORS.slate500, background: COLORS.slate50 }}
                >
                  {photoUploading ? 'Uploading...' : form.photoUrl ? 'Change photo' : 'Add a photo'}
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                <div>
                  <p style={{ ...modalLabelStyle, margin: '0 0 6px 0' }}>Category</p>
                  <select value={form.category} onChange={(e) => setForm(prev => ({ ...prev, category: e.target.value }))} style={{ width: '100%', padding: '9px 11px', borderRadius: '9px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}>
                    {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <p style={{ ...modalLabelStyle, margin: '0 0 6px 0' }}>Room</p>
                  <select value={form.room} onChange={(e) => setForm(prev => ({ ...prev, room: e.target.value }))} style={{ width: '100%', padding: '9px 11px', borderRadius: '9px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}>
                    {ROOM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              <p style={modalLabelStyle}>Condition</p>
              <select value={form.condition} onChange={(e) => setForm(prev => ({ ...prev, condition: e.target.value }))} style={{ width: '100%', padding: '9px 11px', borderRadius: '9px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="poor">Poor</option>
              </select>

              <p style={modalLabelStyle}>Notes (optional)</p>
              <textarea
                value={form.notes} onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Any detail worth flagging — colour, small damage, model, etc."
                style={{ width: '100%', padding: '9px 11px', borderRadius: '9px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', minHeight: '56px', boxSizing: 'border-box' }}
              />

              {error && <p style={modalErrorStyle}>{error}</p>}

              <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                <button type="button" onClick={closeModal} style={modalCancelBtnStyle}>Cancel</button>
                <button type="submit" disabled={saving || photoUploading} style={{ ...modalConfirmBtnStyle, background: COLORS.teal700, opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Add to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
