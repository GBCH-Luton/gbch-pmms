// Follow-Ups -- one cross-property queue combining Temporary Tasks with
// chaseable Property Notes (ones with a Due Date/Follow-Up Date set), per
// the mockup approved 2026-09-02. A per-property Notes/Temporary Tasks tab
// can't give you "everything that needs chasing, across every property" --
// this is that view. Admin-only for now, same restriction as Temporary
// Tasks itself while the whole feature is still being finished.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { formatUKDate } from './shared'
import { attachProperties } from '../../lib/properties'

const TILES = [
  { key: 'overdue', label: 'Overdue', bg: COLORS.red600 },
  { key: 'today', label: 'Due Today', bg: COLORS.amber600 },
  { key: 'week', label: 'Due This Week', bg: '#c07a1f' },
  { key: 'ext', label: 'Awaiting External', bg: COLORS.purple700 },
  { key: 'int', label: 'Awaiting Internal', bg: COLORS.indigo700 },
  { key: 'done', label: 'Resolved / Closed', bg: COLORS.slate500 },
]

const CAT_STYLES = {
  Observation: { bg: COLORS.slate100, color: COLORS.slate500 },
  Flag: { bg: COLORS.red100, color: COLORS.red600 },
  Reminder: { bg: COLORS.amber100, color: COLORS.amber600 },
  Complaint: { bg: COLORS.orange100, color: COLORS.orange700 },
}
const TASK_TYPE_STYLE = { bg: COLORS.teal100, color: COLORS.teal700 }

// Status-based buckets win over date-based ones -- a task waiting on
// someone else is more usefully grouped by WHO it's waiting on than by
// date (matches the mockup's own reasoning).
function bucketFor(item) {
  if (item.kind === 'Task') {
    if (item.status === 'Resolved' || item.status === 'Closed') return 'done'
    if (item.status === 'Awaiting Response') return 'ext'
    if (item.status === 'Awaiting Internal Team') return 'int'
  } else {
    if (!item.is_flagged || item.flag_status === 'Resolved') return 'done'
  }

  const effectiveDate = item.follow_up_date || item.due_date
  if (!effectiveDate) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(effectiveDate)
  const daysDiff = Math.floor((target - today) / 86400000)

  if (daysDiff < 0) return 'overdue'
  if (daysDiff === 0) return 'today'
  if (daysDiff <= 7) return 'week'
  return null
}

export default function AdminFollowUps({ onNavigate }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [activeTile, setActiveTile] = useState(null)

  useEffect(() => {
    fetchItems()
  }, [])

  async function fetchItems() {
    setError('')

    const { data: tasksData, error: tasksError } = await supabase
      .schema('pmms')
      .from('temporary_tasks')
      .select('id, task_type, task_title, status, due_date, follow_up_date, property_id, created_at')
      .order('created_at', { ascending: false })

    // Only notes actually meant to be chased -- one with neither date set
    // isn't something this queue exists for.
    const { data: notesData, error: notesError } = await supabase
      .schema('pmms')
      .from('property_notes')
      .select('id, note_category, note_text, is_flagged, flag_status, due_date, follow_up_date, property_id, created_at')
      .or('due_date.not.is.null,follow_up_date.not.is.null')
      .order('created_at', { ascending: false })

    if (tasksError || notesError) {
      setError((tasksError || notesError).message)
      setItems([])
      return
    }

    const tasksWithProps = await attachProperties(tasksData || [], 'address')
    const notesWithProps = await attachProperties(notesData || [], 'address')

    const merged = [
      ...tasksWithProps.map(t => ({
        id: `task-${t.id}`, kind: 'Task', property: t.property, category: t.task_type,
        text: t.task_title || '(no title)', status: t.status, due_date: t.due_date, follow_up_date: t.follow_up_date,
        propertyId: t.property_id,
      })),
      ...notesWithProps.map(n => ({
        id: `note-${n.id}`, kind: 'Note', property: n.property, category: n.note_category || 'Note',
        text: n.note_text, is_flagged: n.is_flagged, flag_status: n.flag_status, due_date: n.due_date, follow_up_date: n.follow_up_date,
        propertyId: n.property_id,
      })),
    ].map(item => ({ ...item, bucket: bucketFor(item) }))

    setItems(merged)
  }

  if (items === null) {
    return (
      <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading follow-ups...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load follow-ups</p>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{error}</p>
      </div>
    )
  }

  const tileCounts = Object.fromEntries(TILES.map(t => [t.key, items.filter(i => i.bucket === t.key).length]))

  let visible = search.trim()
    ? items.filter(i => (i.property?.address || '').toLowerCase().includes(search.trim().toLowerCase()))
    : items
  visible = activeTile ? visible.filter(i => i.bucket === activeTile) : visible.filter(i => i.bucket !== 'done')

  return (
    <div>
      <p style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Follow-Ups</p>
      <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: COLORS.slate500 }}>Every Temporary Task and chaseable note that needs following up, across all properties.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginBottom: '18px' }}>
        {TILES.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTile(prev => (prev === t.key ? null : t.key))}
            style={{
              border: activeTile === t.key ? `2.5px solid ${COLORS.slate900}` : 'none', borderRadius: '14px', padding: '12px 10px',
              cursor: 'pointer', textAlign: 'left', background: t.bg, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
          >
            <p style={{ margin: '0 0 4px 0', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.85)', lineHeight: 1.25 }}>{t.label}</p>
            <p style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.white, fontVariantNumeric: 'tabular-nums' }}>{tileCounts[t.key]}</p>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by property..."
          style={{ flex: '1 1 260px', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
        />
        {activeTile && (
          <button onClick={() => setActiveTile(null)} style={{ background: 'none', border: 'none', color: COLORS.teal700, fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
            Clear filter ✕
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', textAlign: 'center', padding: '30px 0' }}>No follow-ups match this view.</p>
      ) : (
        visible.map(item => {
          const catStyle = item.kind === 'Task' ? TASK_TYPE_STYLE : (CAT_STYLES[item.category] || CAT_STYLES.Observation)
          const tile = TILES.find(t => t.key === item.bucket)
          return (
            <button
              key={item.id}
              onClick={() => onNavigate?.('properties', { propertyId: item.propertyId, tab: item.kind === 'Task' ? 'Temporary Tasks' : 'Notes' })}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: COLORS.white, border: 'none', borderRadius: '13px', padding: '13px 16px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}
            >
              <span style={{ fontSize: '9.5px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.04em', width: '34px', flexShrink: 0 }}>{item.kind}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap', flexShrink: 0, background: catStyle.bg, color: catStyle.color }}>{item.category}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '12px', fontWeight: 700, color: COLORS.teal700 }}>{item.property?.address || 'Unknown property'}</p>
                <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</p>
              </div>
              {tile && (
                <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap', flexShrink: 0, background: item.bucket === 'overdue' ? COLORS.red100 : COLORS.slate100, color: item.bucket === 'overdue' ? COLORS.red600 : COLORS.slate600 }}>
                  {tile.label}{(item.due_date || item.follow_up_date) ? ` · ${formatUKDate(item.follow_up_date || item.due_date)}` : ''}
                </span>
              )}
            </button>
          )
        })
      )}
    </div>
  )
}
