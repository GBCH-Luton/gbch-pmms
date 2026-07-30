// Admin-only "View As" picker: pick a staff member and the browser session
// genuinely switches to being logged in as them (see supabase/functions/
// impersonate-staff/index.ts for the server-side mechanics and
// client/src/lib/impersonation.js for the session-swap itself). Every
// eligibility rule here is also enforced server-side -- this filtering is
// just so the list doesn't show people the Edge Function would reject
// anyway.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { startImpersonation } from '../../lib/impersonation'
import { thStyle, tdStyle, actionBtnStyle, extractFunctionError } from './shared'

export default function AdminViewAs({ profile }) {
  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: allStaff, error: staffError } = await supabase
      .from('staff')
      .select('id, name, email, job_title, active, must_reset_password')
      .order('name')

    const { data: roleRows, error: roleRowsError } = await supabase
      .schema('pmms')
      .from('staff_roles')
      .select('staff_id, role')

    if (!staffError) {
      const roleByStaffId = {}
      if (!roleRowsError) {
        (roleRows || []).forEach(r => { roleByStaffId[r.staff_id] = r.role })
      }
      setStaffList((allStaff || []).map(s => ({ ...s, role: roleByStaffId[s.id] || null })))
    }
    setLoading(false)
  }

  const eligible = staffList.filter(s =>
    s.id !== profile.id &&
    s.active !== false &&
    !s.must_reset_password &&
    s.role &&
    s.role !== 'Admin'
  )

  const filtered = eligible.filter(s => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.role.toLowerCase().includes(q) || (s.job_title || '').toLowerCase().includes(q)
  })

  const selected = eligible.find(s => s.id === selectedId) || null

  function handleSelectRow(staffId) {
    setError('')
    setSelectedId(prev => prev === staffId ? null : staffId)
  }

  // Selecting a row just highlights it -- switching only happens from the
  // explicit confirm button below, since a single click-to-act button per
  // row was too easy to misclick (found live: clicked "View As" on a
  // builder while meaning to pick a manager one row down).
  async function handleConfirmViewAs() {
    if (!selected) return
    setError('')
    setSwitching(true)
    const { data, error: fnError } = await supabase.functions.invoke('impersonate-staff', { body: { staffId: selected.id } })
    if (fnError) {
      setError(await extractFunctionError(fnError))
      setSwitching(false)
      return
    }
    if (data?.error) {
      setError(data.error)
      setSwitching(false)
      return
    }
    const { error: swapError } = await startImpersonation({
      hashedToken: data.hashedToken,
      targetName: data.targetName,
      impersonationEventId: data.impersonationEventId,
    })
    if (swapError) {
      setError(swapError)
      setSwitching(false)
    }
    // On success, App.jsx's auth listener takes over and routing redirects
    // to the target's dashboard -- no navigation call needed here.
  }

  if (loading) return <p style={{ padding: '24px', color: COLORS.slate500 }}>Loading...</p>

  return (
    <div style={{ padding: '24px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: COLORS.slate900, marginBottom: '4px' }}>View As</h1>
      <p style={{ fontSize: '13px', color: COLORS.slate500, marginBottom: '16px' }}>
        See PMMS exactly as another staff member would. You'll be able to return to your own account at any time.
      </p>

      <input
        type="text"
        placeholder="Search by name, role, or job title..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', maxWidth: '360px', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', marginBottom: '16px' }}
      />

      {error && (
        <p style={{ color: COLORS.red600, fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>{error}</p>
      )}

      <div style={{ background: COLORS.white, borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Job Title</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr
                key={s.id}
                onClick={() => handleSelectRow(s.id)}
                style={{
                  borderTop: `1px solid ${COLORS.slate100}`, cursor: 'pointer',
                  background: selectedId === s.id ? COLORS.blue50 : 'transparent',
                }}
              >
                <td style={tdStyle}>{s.name}</td>
                <td style={tdStyle}>{s.role}</td>
                <td style={tdStyle}>{s.job_title || '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={3} style={{ ...tdStyle, textAlign: 'center', color: COLORS.slate400, padding: '24px' }}>
                  No eligible staff members found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{
          position: 'sticky', bottom: '16px', marginTop: '16px', background: COLORS.slate900, color: COLORS.white,
          borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '12px', boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            Selected: {selected.name} ({selected.role})
          </span>
          <button
            onClick={handleConfirmViewAs}
            disabled={switching}
            style={actionBtnStyle}
          >
            {switching ? 'Switching...' : `View As ${selected.name}`}
          </button>
        </div>
      )}
    </div>
  )
}
