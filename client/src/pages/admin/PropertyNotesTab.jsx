// Notes tab of the Property Profile. See scripts/add_property_notes_table.sql
// for the pmms.property_notes table this component depends on -- run it
// before using this tab.
//
// This table already existed in the sandbox project before this file was
// written (origin unknown), with column names that don't match a first
// guess at the spec -- category is `note_category`, author is `author`
// (not author_name). This component matches that real, already-live
// schema:
//
// CREATE TABLE pmms.property_notes (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   property_id uuid REFERENCES pmms.properties(id) ON DELETE CASCADE,
//   note_category text,
//   note_text text NOT NULL,
//   author text,
//   is_flagged boolean NOT NULL DEFAULT false,
//   flag_status text DEFAULT 'Open',
//   created_at timestamptz DEFAULT now()
// );

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import {
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, formatUKDateTime, formatUKDate,
} from './shared'

const CATEGORIES = ['Observation', 'Flag', 'Reminder', 'Complaint']
const FILTER_TABS = ['All', ...CATEGORIES]
const FLAG_STATUSES = ['Open', 'In Progress', 'Resolved']

const CATEGORY_STYLES = {
  Observation: { bg: COLORS.slate100, color: COLORS.slate500 },
  Flag: { bg: COLORS.red100, color: COLORS.red600 },
  Reminder: { bg: COLORS.amber100, color: COLORS.amber600 },
  Complaint: { bg: COLORS.orange100, color: COLORS.orange700 },
}

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

const emptyForm = { note_category: '', note_text: '', flag_this: false, due_date: '', follow_up_date: '' }

function NoteFormModal({ property, note, profile, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (note) {
      setForm({
        note_category: note.note_category || '', note_text: note.note_text || '', flag_this: !!note.is_flagged,
        due_date: note.due_date || '', follow_up_date: note.follow_up_date || '',
      })
    } else {
      setForm(emptyForm)
    }
    setError('')
  }, [note])

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setError('')
    if (!form.note_text.trim()) { setError('Note Text is required.'); return }

    setSaving(true)

    const payload = {
      note_category: form.note_category || null,
      note_text: form.note_text.trim(),
      is_flagged: form.flag_this,
      flag_status: form.flag_this ? (note?.is_flagged ? note.flag_status || 'Open' : 'Open') : null,
      due_date: form.due_date || null,
      follow_up_date: form.follow_up_date || null,
    }

    let result
    if (note) {
      result = await supabase.schema('pmms').from('property_notes').update(payload).eq('id', note.id).select().single()
    } else {
      result = await supabase.schema('pmms').from('property_notes').insert({
        ...payload,
        property_id: property.id,
        author: profile?.name || null,
      }).select().single()
    }

    setSaving(false)

    if (result.error) { setError(result.error.message); return }

    onSaved(result.data)
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '460px' }}>
        <p style={modalTitleStyle}>{note ? 'Edit Note' : 'Add Note'}</p>

        <p style={modalLabelStyle}>Note Category</p>
        <select value={form.note_category} onChange={(e) => set('note_category', e.target.value)} style={inputStyle}>
          <option value="">Select...</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <p style={modalLabelStyle}>Note Text</p>
        <textarea value={form.note_text} onChange={(e) => set('note_text', e.target.value)} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
          <div>
            <p style={modalLabelStyle}>Due Date</p>
            <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <p style={modalLabelStyle}>Follow-Up Date</p>
            <input type="date" value={form.follow_up_date} onChange={(e) => set('follow_up_date', e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '16px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>Flag this item</span>
          <button
            onClick={() => set('flag_this', !form.flag_this)}
            style={{
              width: '48px', height: '28px', borderRadius: '999px', border: 'none', cursor: 'pointer', position: 'relative',
              background: form.flag_this ? COLORS.red600 : COLORS.slate300, transition: 'background 0.15s',
            }}
          >
            <span style={{
              position: 'absolute', top: '3px', left: form.flag_this ? '23px' : '3px', width: '22px', height: '22px',
              borderRadius: '50%', background: COLORS.white, transition: 'left 0.15s',
            }} />
          </button>
        </div>

        <p style={modalLabelStyle}>Author</p>
        <input type="text" value={note?.author || profile?.name || ''} disabled style={{ ...inputStyle, background: COLORS.slate50, color: COLORS.slate500 }} />

        {error && <p style={modalErrorStyle}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...modalConfirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving...' : note ? 'Save changes' : 'Add Note'}
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
        <p style={modalTitleStyle}>Delete Note</p>
        <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: COLORS.slate500 }}>This cannot be undone. Are you sure?</p>
        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onCancel} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            style={{ flex: 2, padding: '10px', background: COLORS.red600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PropertyNotesTab({ property, profile }) {
  const readOnly = profile?.division === 'Landlord Liaison'
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [modalNote, setModalNote] = useState(undefined) // undefined = closed, null = add, object = edit
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [scrollToId, setScrollToId] = useState(null)
  const [flagStatusErrors, setFlagStatusErrors] = useState({})

  const noteRefs = useRef({})

  useEffect(() => {
    fetchNotes()
  }, [property.id])

  useEffect(() => {
    if (scrollToId && noteRefs.current[scrollToId]) {
      noteRefs.current[scrollToId].scrollIntoView({ behavior: 'smooth', block: 'center' })
      setScrollToId(null)
    }
  }, [scrollToId, notes, search, categoryFilter])

  async function fetchNotes() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_notes')
      .select('*')
      .eq('property_id', property.id)
      .order('created_at', { ascending: false })

    if (error) {
      setNotes([])
      setLoadError(error.message)
      setLoading(false)
      return
    }

    setNotes(data || [])
    setLoading(false)
  }

  function handleSaved(saved) {
    setNotes(prev => {
      const exists = prev.some(n => n.id === saved.id)
      return exists ? prev.map(n => n.id === saved.id ? saved : n) : [saved, ...prev]
    })
    setModalNote(undefined)
  }

  async function handleDeleteConfirm() {
    setDeleting(true)
    const { error } = await supabase.schema('pmms').from('property_notes').delete().eq('id', deleteTarget.id)
    setDeleting(false)

    if (!error) {
      setNotes(prev => prev.filter(n => n.id !== deleteTarget.id))
    }
    setDeleteTarget(null)
  }

  async function handleFlagStatusChange(note, newStatus) {
    setFlagStatusErrors(prev => ({ ...prev, [note.id]: '' }))

    const { data, error } = await supabase
      .schema('pmms')
      .from('property_notes')
      .update({ flag_status: newStatus })
      .eq('id', note.id)
      .select()
      .single()

    if (error) {
      setFlagStatusErrors(prev => ({ ...prev, [note.id]: error.message }))
      return
    }
    setNotes(prev => prev.map(n => n.id === note.id ? data : n))
  }

  function jumpToNote(note) {
    setSearch('')
    setCategoryFilter('All')
    setScrollToId(note.id)
  }

  const openFlagged = notes.filter(n => n.is_flagged && n.flag_status !== 'Resolved')

  const filteredNotes = notes.filter(n => {
    if (categoryFilter !== 'All' && n.note_category !== categoryFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const matches = (n.note_text || '').toLowerCase().includes(q) || (n.author || '').toLowerCase().includes(q) || (n.note_category || '').toLowerCase().includes(q)
      if (!matches) return false
    }
    return true
  })

  if (loading) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading notes...</p>
      </div>
    )
  }

  return (
    <div>
      {openFlagged.length > 0 && (
        <div style={{ background: COLORS.amber50, border: `1px solid ${COLORS.amber300}`, borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' }}>
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: COLORS.amber800 }}>
            ⚑ {openFlagged.length} open flagged item{openFlagged.length === 1 ? '' : 's'}
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {openFlagged.map(n => (
              <button
                key={n.id}
                onClick={() => jumpToNote(n)}
                style={{
                  padding: '6px 12px', background: COLORS.white, border: `1px solid ${COLORS.amber300}`, borderRadius: '20px',
                  fontSize: '12px', fontWeight: 700, color: COLORS.amber800, cursor: 'pointer', maxWidth: '220px',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {n.note_text.slice(0, 40)}{n.note_text.length > 40 ? '…' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by text, author, or category..."
          style={{ flex: '1 1 260px', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
        />
        {!readOnly && (
          <button
            onClick={() => setModalNote(null)}
            style={{ padding: '10px 18px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ＋ Add Note
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap', borderBottom: `1px solid ${COLORS.slate200}` }}>
        {FILTER_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setCategoryFilter(tab)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', borderBottom: categoryFilter === tab ? `2px solid ${COLORS.teal700}` : '2px solid transparent',
              color: categoryFilter === tab ? COLORS.teal700 : COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer', marginBottom: '-1px',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {loadError ? (
        <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load notes</p>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{loadError}</p>
        </div>
      ) : filteredNotes.length === 0 ? (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No notes found.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredNotes.map(note => {
            const catStyle = CATEGORY_STYLES[note.note_category] || CATEGORY_STYLES.Observation
            return (
              <div
                key={note.id}
                ref={(el) => { noteRefs.current[note.id] = el }}
                style={{ background: COLORS.white, borderRadius: '16px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {note.note_category && (
                      <span style={{ fontSize: '10px', fontWeight: 700, color: catStyle.color, background: catStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>{note.note_category}</span>
                    )}
                    {note.is_flagged && (
                      <>
                        <span style={{ fontSize: '10px', fontWeight: 800, color: COLORS.red600, background: COLORS.red100, padding: '3px 10px', borderRadius: '20px' }}>⚑ Flagged</span>
                        <select
                          value={note.flag_status || 'Open'}
                          disabled={readOnly}
                          onChange={(e) => handleFlagStatusChange(note, e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '11px', fontWeight: 700, color: COLORS.slate900, background: COLORS.slate50, cursor: readOnly ? 'default' : 'pointer' }}
                        >
                          {FLAG_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </>
                    )}
                  </div>

                  {!readOnly && (
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button
                        onClick={() => setModalNote(note)}
                        style={{ padding: '6px 12px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(note)}
                        style={{ padding: '6px 12px', background: COLORS.white, color: COLORS.red600, border: `1px solid ${COLORS.red200}`, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: COLORS.slate900, whiteSpace: 'pre-wrap' }}>{note.note_text}</p>
                {(note.due_date || note.follow_up_date) && (
                  <p style={{ margin: '0 0 6px 0', fontSize: '11.5px', fontWeight: 700, color: COLORS.slate500 }}>
                    {note.due_date && `Due ${formatUKDate(note.due_date)}`}
                    {note.due_date && note.follow_up_date && ' · '}
                    {note.follow_up_date && `Follow up ${formatUKDate(note.follow_up_date)}`}
                  </p>
                )}
                <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate400 }}>
                  {note.author || 'Unknown'} · {formatUKDateTime(note.created_at)}
                </p>
                {flagStatusErrors[note.id] && (
                  <p style={modalErrorStyle}>⚠ Couldn't update status: {flagStatusErrors[note.id]}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalNote !== undefined && (
        <NoteFormModal
          property={property}
          note={modalNote}
          profile={profile}
          onClose={() => setModalNote(undefined)}
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
