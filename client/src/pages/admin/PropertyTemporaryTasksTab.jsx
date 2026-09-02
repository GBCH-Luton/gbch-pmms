// Temporary Tasks tab of the Property Profile -- read-only list of
// pmms.temporary_tasks rows logged against this property (see
// scripts/add_temporary_tasks_table.sql). Creation happens on the
// dedicated "Add Temporary Task" nav page (AdminTemporaryTasks.jsx), same
// "own full page, not a cramped inline form" precedent as Log a Ticket --
// these are multi-section forms, not a quick add-note modal.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { formatUKDate, formatUKDateTime } from './shared'

const STATUS_STYLES = {
  New: { bg: COLORS.blue100, color: COLORS.blue700 },
  'In Progress': { bg: COLORS.amber100, color: COLORS.amber600 },
  'Awaiting Response': { bg: COLORS.purple100, color: COLORS.purple700 },
  'Awaiting Internal Team': { bg: COLORS.indigo100, color: COLORS.indigo700 },
  Resolved: { bg: COLORS.green100, color: COLORS.green600 },
  Closed: { bg: COLORS.slate100, color: COLORS.slate500 },
}
const PRIORITY_STYLES = {
  Low: COLORS.slate500, Medium: COLORS.blue700, High: COLORS.amber600, Urgent: COLORS.red600,
}

export default function PropertyTemporaryTasksTab({ property, onNavigate }) {
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .schema('pmms')
      .from('temporary_tasks')
      .select('id, task_type, task_title, priority, status, due_date, follow_up_date, created_by_name, created_at')
      .eq('property_id', property.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (fetchError) { setError(fetchError.message); setTasks([]); return }
        setTasks(data || [])
      })
  }, [property.id])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Temporary Tasks {tasks ? `(${tasks.length})` : ''}
        </p>
        <button
          onClick={() => onNavigate?.('temporary-tasks')}
          style={{ padding: '8px 16px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          ＋ Add Temporary Task
        </button>
      </div>

      {error && <p style={{ fontSize: '13px', color: COLORS.red600 }}>{error}</p>}
      {tasks === null && !error && <p style={{ fontSize: '13px', color: COLORS.slate400 }}>Loading...</p>}
      {tasks && tasks.length === 0 && (
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No temporary tasks logged against this property yet.</p>
      )}

      {tasks && tasks.map(t => {
        const statusStyle = STATUS_STYLES[t.status] || STATUS_STYLES.New
        return (
          <div key={t.id} style={{ background: COLORS.white, borderRadius: '14px', padding: '14px 18px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <div>
                <span style={{ fontSize: '10.5px', fontWeight: 700, color: PRIORITY_STYLES[t.priority] || COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t.priority} · {t.task_type}</span>
                <p style={{ margin: '2px 0 0 0', fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>{t.task_title || '(no title)'}</p>
              </div>
              <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap', background: statusStyle.bg, color: statusStyle.color }}>{t.status}</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11.5px', color: COLORS.slate400, fontWeight: 600 }}>
              {t.due_date && <span>Due {formatUKDate(t.due_date)}</span>}
              {t.follow_up_date && <span>Follow up {formatUKDate(t.follow_up_date)}</span>}
              <span>Logged by {t.created_by_name || 'Unknown'} · {formatUKDateTime(t.created_at)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
