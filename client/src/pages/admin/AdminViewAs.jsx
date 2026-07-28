// Admin-only "View As" picker: pick a staff member and the browser session
// genuinely switches to being logged in as them (see supabase/functions/
// impersonate-staff/index.ts for the server-side mechanics and
// client/src/lib/impersonation.js for the session-swap itself). Every
// eligibility rule here is also enforced server-side -- this filtering is
// just so the list doesn't show people the Edge Function would reject
// anyway.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { startImpersonation } from '../../lib/impersonation'
import { thStyle, tdStyle, actionBtnStyle, extractFunctionError } from './shared'

export default function AdminViewAs({ profile }) {
  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)
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

  async function handleViewAs(staff) {
    setError('')
    setBusyId(staff.id)
    const { data, error: fnError } = await supabase.functions.invoke('impersonate-staff', { body: { staffId: staff.id } })
    if (fnError) {
      setError(await extractFunctionError(fnError))
      setBusyId(null)
      return
    }
    if (data?.error) {
      setError(data.error)
      setBusyId(null)
      return
    }
    const { error: swapError } = await startImpersonation({
      hashedToken: data.hashedToken,
      targetName: data.targetName,
      impersonationEventId: data.impersonationEventId,
    })
    if (swapError) {
      setError(swapError)
      setBusyId(null)
    }
    // On success, App.jsx's auth listener takes over and routing redirects
    // to the target's dashboard -- no navigation call needed here.
  }

  if (loading) return <p style={{ padding: '24px', color: '#64748b' }}>Loading...</p>

  return (
    <div style={{ padding: '24px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>View As</h1>
      <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
        See PMMS exactly as another staff member would. You'll be able to return to your own account at any time.
      </p>

      <input
        type="text"
        placeholder="Search by name, role, or job title..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', maxWidth: '360px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', marginBottom: '16px' }}
      />

      {error && (
        <p style={{ color: '#dc2626', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>{error}</p>
      )}

      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Job Title</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={tdStyle}>{s.name}</td>
                <td style={tdStyle}>{s.role}</td>
                <td style={tdStyle}>{s.job_title || '—'}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <button
                    onClick={() => handleViewAs(s)}
                    disabled={busyId === s.id}
                    style={actionBtnStyle}
                  >
                    {busyId === s.id ? 'Switching...' : 'View As'}
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '24px' }}>
                  No eligible staff members found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
