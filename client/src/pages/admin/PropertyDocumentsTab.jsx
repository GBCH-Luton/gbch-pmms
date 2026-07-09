// Documents tab of the Property Profile. See
// scripts/add_property_documents_table.sql for the pmms.property_documents
// table this component depends on -- run it before using this tab. No SQL
// was given for this one in the request, so the table follows the same
// conventions as the other new property-profile tables this session
// (RLS explicitly disabled). Documents reuse the
// 'property-docs' storage bucket already created by
// add_property_compliance_table.sql.
//
// CREATE TABLE pmms.property_documents (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   property_id uuid REFERENCES pmms.properties(id) ON DELETE CASCADE,
//   document_name text NOT NULL,
//   document_category text,
//   document_date date,
//   expiry_date date,
//   notes text,
//   file_url text,
//   uploaded_by text,
//   created_at timestamptz DEFAULT now()
// );

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, formatUKDate,
} from './shared'

const CATEGORIES = ['Safety', 'Maintenance', 'Legal', 'Tenant', 'Other']
const FILTER_TABS = ['All', ...CATEGORIES]

const CATEGORY_STYLES = {
  Safety: { bg: '#fee2e2', color: '#dc2626' },
  Maintenance: { bg: '#ccfbf1', color: '#0d9488' },
  Legal: { bg: '#dbeafe', color: '#1e3a8a' },
  Tenant: { bg: '#f3e8ff', color: '#9333ea' },
  Other: { bg: '#f1f5f9', color: '#64748b' },
}

const RAG_STYLES = {
  green: { bg: '#dcfce7', color: '#16a34a' },
  amber: { bg: '#fef3c7', color: '#d97706' },
  red: { bg: '#fee2e2', color: '#dc2626' },
  grey: { bg: '#f1f5f9', color: '#64748b' },
}

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

function expiryRag(expiryDate) {
  if (!expiryDate) return { tier: 'grey', label: 'No expiry' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.floor((new Date(expiryDate) - today) / 86400000)
  if (daysLeft < 0) return { tier: 'red', label: 'Expired' }
  if (daysLeft <= 90) return { tier: 'amber', label: `Expires in ${daysLeft}d` }
  return { tier: 'green', label: 'Valid' }
}

const emptyForm = { document_name: '', document_category: '', document_date: '', expiry_date: '', notes: '', file_url: '' }

function DocumentFormModal({ property, profile, doc, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (doc) {
      setForm({
        document_name: doc.document_name || '',
        document_category: doc.document_category || '',
        document_date: doc.document_date || '',
        expiry_date: doc.expiry_date || '',
        notes: doc.notes || '',
        file_url: doc.file_url || '',
      })
    } else {
      setForm(emptyForm)
    }
    setError('')
  }, [doc])

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleFilePick(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError('')
    const path = `${property.id}/documents/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('property-docs').upload(path, file)
    setUploading(false)

    if (uploadError) { setError(`Upload failed: ${uploadError.message}`); return }

    const url = supabase.storage.from('property-docs').getPublicUrl(path).data.publicUrl
    set('file_url', url)
  }

  async function handleSave() {
    setError('')
    if (!form.document_name.trim()) { setError('Document Name is required.'); return }

    setSaving(true)

    const payload = {
      property_id: property.id,
      document_name: form.document_name.trim(),
      document_category: form.document_category || null,
      document_date: form.document_date || null,
      expiry_date: form.expiry_date || null,
      notes: form.notes.trim() || null,
      file_url: form.file_url || null,
      uploaded_by: profile?.name || null,
    }

    let result
    if (doc) {
      result = await supabase.schema('pmms').from('property_documents').update(payload).eq('id', doc.id).select().single()
    } else {
      result = await supabase.schema('pmms').from('property_documents').insert(payload).select().single()
    }

    setSaving(false)

    if (result.error) { setError(result.error.message); return }

    onSaved(result.data)
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '480px' }}>
        <p style={modalTitleStyle}>{doc ? 'Edit Document' : 'Upload Document'}</p>

        <p style={modalLabelStyle}>Document Name</p>
        <input type="text" value={form.document_name} onChange={(e) => set('document_name', e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Category</p>
        <select value={form.document_category} onChange={(e) => set('document_category', e.target.value)} style={inputStyle}>
          <option value="">Select...</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <p style={modalLabelStyle}>Document Date</p>
        <input type="date" value={form.document_date} onChange={(e) => set('document_date', e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Expiry Date (optional)</p>
        <input type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Notes</p>
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />

        <p style={modalLabelStyle}>File</p>
        {form.file_url && (
          <a href={form.file_url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 700, color: '#1d4ed8' }}>
            📄 View current file ↗
          </a>
        )}
        <input type="file" id="document-file-input" onChange={handleFilePick} style={{ display: 'none' }} />
        <button
          onClick={() => document.getElementById('document-file-input').click()}
          disabled={uploading}
          style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}
        >
          {uploading ? 'Uploading...' : form.file_url ? 'Replace file' : 'Upload file'}
        </button>

        <p style={modalLabelStyle}>Uploaded By</p>
        <input type="text" value={profile?.name || ''} disabled style={{ ...inputStyle, background: '#f8fafc', color: '#64748b' }} />

        {error && <p style={modalErrorStyle}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...modalConfirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving...' : doc ? 'Save changes' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ onCancel, onConfirm, deleting }) {
  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '380px' }}>
        <p style={modalTitleStyle}>Delete Document</p>
        <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#64748b' }}>This cannot be undone. Are you sure?</p>
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onCancel} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{ flex: 2, padding: '10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PropertyDocumentsTab({ property, profile }) {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [modalDoc, setModalDoc] = useState(undefined) // undefined = closed, null = add, object = edit
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchDocuments()
  }, [property.id])

  async function fetchDocuments() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_documents')
      .select('*')
      .eq('property_id', property.id)
      .order('created_at', { ascending: false })

    if (error) {
      setDocuments([])
      setLoadError(error.message)
      setLoading(false)
      return
    }

    setDocuments(data || [])
    setLoading(false)
  }

  function handleSaved(saved) {
    setDocuments(prev => {
      const exists = prev.some(d => d.id === saved.id)
      return exists ? prev.map(d => d.id === saved.id ? saved : d) : [saved, ...prev]
    })
    setModalDoc(undefined)
  }

  async function handleDeleteConfirm() {
    setDeleting(true)
    const { error } = await supabase.schema('pmms').from('property_documents').delete().eq('id', deleteTarget.id)
    setDeleting(false)

    if (!error) {
      setDocuments(prev => prev.filter(d => d.id !== deleteTarget.id))
    }
    setDeleteTarget(null)
  }

  const filteredDocs = documents.filter(d => {
    if (categoryFilter !== 'All' && d.document_category !== categoryFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const matches = (d.document_name || '').toLowerCase().includes(q) || (d.notes || '').toLowerCase().includes(q)
      if (!matches) return false
    }
    return true
  })

  if (loading) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8', fontWeight: 600 }}>Loading documents...</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by document name or notes..."
          style={{ flex: '1 1 260px', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
        />
        <button
          onClick={() => setModalDoc(null)}
          style={{ padding: '10px 18px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          ＋ Upload Document
        </button>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0' }}>
        {FILTER_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setCategoryFilter(tab)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', borderBottom: categoryFilter === tab ? '2px solid #0f766e' : '2px solid transparent',
              color: categoryFilter === tab ? '#0f766e' : '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer', marginBottom: '-1px',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loadError ? (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>Couldn't load documents</p>
          <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d', fontFamily: 'monospace' }}>{loadError}</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8', fontStyle: 'italic' }}>No documents found.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredDocs.map(doc => {
            const catStyle = CATEGORY_STYLES[doc.document_category] || CATEGORY_STYLES.Other
            const rag = expiryRag(doc.expiry_date)
            const ragStyle = RAG_STYLES[rag.tier]
            return (
              <div key={doc.id} style={{ background: '#fff', borderRadius: '16px', padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 220px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    {doc.file_url ? (
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '14px', fontWeight: 700, color: '#1d4ed8' }}>{doc.document_name}</a>
                    ) : (
                      <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{doc.document_name}</span>
                    )}
                    {doc.document_category && (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: catStyle.color, background: catStyle.bg, padding: '2px 8px', borderRadius: '20px' }}>{doc.document_category}</span>
                    )}
                  </div>
                  {doc.notes && (
                    <p style={{ margin: 0, fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '360px' }}>{doc.notes}</p>
                  )}
                </div>

                <div style={{ flex: '1 1 120px', fontSize: '12px', color: '#64748b' }}>
                  {doc.document_date ? formatUKDate(doc.document_date) : '—'}
                </div>

                <div style={{ flex: '1 1 140px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: ragStyle.color, background: ragStyle.bg, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                    {rag.label}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => setModalDoc(doc)}
                    style={{ padding: '7px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(doc)}
                    style={{ padding: '7px 14px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modalDoc !== undefined && (
        <DocumentFormModal
          property={property}
          profile={profile}
          doc={modalDoc}
          onClose={() => setModalDoc(undefined)}
          onSaved={handleSaved}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
          deleting={deleting}
        />
      )}
    </div>
  )
}
