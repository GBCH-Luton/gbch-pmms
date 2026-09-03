// Shared "what needs chasing" bucket logic for Temporary Tasks + chaseable
// Property Notes -- pulled out of AdminTemporaryTasks.jsx (2026-09-04) so
// the Dashboard's own summary tiles/Daily Briefing line can share the
// exact same definition instead of a second, driftable copy (same "tile
// count must always match what clicking it shows" reasoning as Pipeline's
// KPI tiles).
import { supabase } from './supabase'
import { COLORS } from './colors'

export const FOLLOWUP_TILES = [
  { key: 'overdue', label: 'Overdue', bg: COLORS.red600 },
  { key: 'today', label: 'Due Today', bg: COLORS.amber600 },
  { key: 'week', label: 'Due This Week', bg: '#c07a1f' },
  { key: 'ext', label: 'Awaiting External', bg: COLORS.purple700 },
  { key: 'int', label: 'Awaiting Internal', bg: COLORS.indigo700 },
  { key: 'done', label: 'Resolved / Closed', bg: COLORS.slate500 },
]

// Status-based buckets win over date-based ones -- a task waiting on
// someone else is more usefully grouped by WHO it's waiting on than by
// date (matches the original mockup's own reasoning).
export function bucketForFollowupItem(item) {
  if (item.kind === 'Task') {
    if (item.status === 'Resolved' || item.status === 'Closed') return 'done'
    if (item.status === 'Awaiting Response') return 'ext'
    if (item.status === 'Awaiting Internal Team') return 'int'
  } else {
    if (!item.is_flagged || item.flag_status === 'Resolved') return 'done'
  }

  const effectiveDate = item.follow_up_date || item.due_date
  if (!effectiveDate) {
    // A flagged Note with no date set still needs to show up SOMEWHERE in
    // this queue -- it was previously excluded entirely (not fetched even),
    // the only place it showed was that one property's own Notes tab.
    // "Overdue" isn't quite literally true without a date, but a flag with
    // no date attached reads as "needs looking at now," the same urgency
    // that tile already carries -- found live, 2026-09-04.
    if (item.kind === 'Note') return 'overdue'
    return null
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(effectiveDate)
  const daysDiff = Math.floor((target - today) / 86400000)

  if (daysDiff < 0) return 'overdue'
  if (daysDiff === 0) return 'today'
  if (daysDiff <= 7) return 'week'
  return null
}

// Lightweight version of AdminTemporaryTasks.jsx's own fetchFollowItems --
// just the bucket counts (no attachProperties/address lookup), for the
// Dashboard's summary tiles and Daily Briefing line, which only need the
// numbers, not the full list.
export async function fetchFollowupCounts() {
  const [{ data: tasksData }, { data: notesData }] = await Promise.all([
    supabase.schema('pmms').from('temporary_tasks').select('status, due_date, follow_up_date'),
    // A flagged note belongs in this queue even with no date set (see
    // bucketForFollowupItem above) -- previously only fetched notes that
    // already had a due/follow-up date, so a plain flagged note never
    // even reached this far.
    supabase.schema('pmms').from('property_notes').select('is_flagged, flag_status, due_date, follow_up_date')
      .or('due_date.not.is.null,follow_up_date.not.is.null,is_flagged.eq.true'),
  ])

  const items = [
    ...(tasksData || []).map(t => ({ kind: 'Task', status: t.status, due_date: t.due_date, follow_up_date: t.follow_up_date })),
    ...(notesData || []).map(n => ({ kind: 'Note', is_flagged: n.is_flagged, flag_status: n.flag_status, due_date: n.due_date, follow_up_date: n.follow_up_date })),
  ]

  const counts = { overdue: 0, today: 0, week: 0, ext: 0, int: 0, done: 0 }
  items.forEach(item => {
    const bucket = bucketForFollowupItem(item)
    if (bucket) counts[bucket] += 1
  })
  return counts
}
