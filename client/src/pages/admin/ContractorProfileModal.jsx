import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { modalOverlayStyle, modalCardStyle, modalLabelStyle, modalCancelBtnStyle, formatUKDate } from './shared'

// Mirrors BuilderProfileModal.jsx (builderId -> contractorId) -- same
// contact-header / stat-tiles / history-table shape, but the history here
// is contractor_job_costs rows (this contractor has no login and does no
// other in-app activity), not comments.
export default function ContractorProfileModal({ contractorId, onClose }) {
  const [contractor, setContractor] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [jobs, setJobs] = useState([]) // [{ cost, ticket }]

  useEffect(() => {
    if (!contractorId) return
    let cancelled = false

    async function load() {
      setContractor(null)
      setLoadError(false)
      setJobs([])

      const { data: contractorData, error: contractorError } = await supabase
        .schema('pmms')
        .from('contractors')
        .select('id, name, company_name, contact_phone, contact_email, active')
        .eq('id', contractorId)
        .single()

      const { data: costRows } = await supabase
        .schema('pmms')
        .from('contractor_job_costs')
        .select('id, amount, receipt_photo_url, created_at, ticket_id')
        .eq('contractor_id', contractorId)
        .order('created_at', { ascending: false })

      const ticketIds = [...new Set((costRows || []).map(c => c.ticket_id))]
      let ticketsById = {}
      if (ticketIds.length > 0) {
        const { data: ticketRows } = await supabase
          .schema('pmms')
          .from('tickets')
          .select('id, ticket_number, description, completed_at')
          .in('id', ticketIds)
        ticketsById = Object.fromEntries((ticketRows || []).map(t => [t.id, t]))
      }

      if (!cancelled) {
        if (contractorError || !contractorData) {
          setLoadError(true)
        } else {
          setContractor(contractorData)
        }
        setJobs((costRows || []).map(c => ({ cost: c, ticket: ticketsById[c.ticket_id] })))
      }
    }

    load()
    return () => { cancelled = true }
  }, [contractorId])

  if (!contractorId) return null

  if (loadError) {
    return (
      <div style={modalOverlayStyle}>
        <div style={{ ...modalCardStyle, maxWidth: '420px' }}>
          <p style={modalLabelStyle}>Couldn't load this profile</p>
          <p style={{ margin: '8px 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>
            Something went wrong fetching this contractor's details. Try closing and reopening their profile.
          </p>
          <button onClick={onClose} style={{ ...modalCancelBtnStyle, width: '100%' }}>Close</button>
        </div>
      </div>
    )
  }

  if (!contractor) {
    return (
      <div style={modalOverlayStyle}>
        <div style={{ ...modalCardStyle, maxWidth: '420px', textAlign: 'center' }}>
          <p style={{ margin: 0, padding: '20px 0', fontSize: '13px', color: COLORS.slate400 }}>Loading profile...</p>
        </div>
      </div>
    )
  }

  const totalPaid = jobs.reduce((sum, j) => sum + Number(j.cost.amount || 0), 0)

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '640px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${COLORS.slate100}`, paddingBottom: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: COLORS.violet100, color: COLORS.violet600, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '16px', flexShrink: 0 }}>
              {contractor.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>{contractor.name}</p>
              <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: COLORS.slate500 }}>
                {[contractor.company_name, contractor.contact_phone, contractor.contact_email].filter(Boolean).join(' · ') || 'No contact details on file'}
              </p>
              <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', fontWeight: 800, color: contractor.active ? COLORS.green600 : COLORS.slate400, background: contractor.active ? COLORS.green100 : COLORS.slate100, padding: '3px 10px', borderRadius: '20px' }}>
                {contractor.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: COLORS.slate400, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '20px' }}>
          <div style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '10px', textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Jobs Done</span>
            <strong style={{ display: 'block', fontSize: '18px', fontWeight: 800, color: COLORS.slate900, marginTop: '4px' }}>{jobs.length}</strong>
          </div>
          <div style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '10px', textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase' }}>Total Paid</span>
            <strong style={{ display: 'block', fontSize: '18px', fontWeight: 800, color: COLORS.teal600, marginTop: '4px' }}>£{totalPaid.toFixed(2)}</strong>
          </div>
        </div>

        {contractor.notes && (
          <>
            <p style={modalLabelStyle}>Notes</p>
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate600 }}>{contractor.notes}</p>
          </>
        )}

        <p style={modalLabelStyle}>Job History</p>
        <div style={{ border: `1px solid ${COLORS.slate100}`, borderRadius: '10px', maxHeight: '300px', overflowY: 'auto' }}>
          {jobs.length === 0 && (
            <p style={{ margin: 0, padding: '12px', fontSize: '13px', color: COLORS.slate400 }}>No jobs logged for this contractor yet.</p>
          )}
          {jobs.map(({ cost, ticket }) => (
            <div key={cost.id} style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.slate100}`, display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>#{ticket?.ticket_number ?? '—'}</span>{' '}
                <span style={{ fontSize: '12px', color: COLORS.slate500 }}>{ticket?.description || '(ticket no longer available)'}</span>
                <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: COLORS.slate400 }}>{ticket?.completed_at ? formatUKDate(ticket.completed_at) : formatUKDate(cost.created_at)}</p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>£{Number(cost.amount).toFixed(2)}</p>
                {cost.receipt_photo_url ? (
                  <a href={cost.receipt_photo_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '2px', fontSize: '11px', fontWeight: 700, color: COLORS.blue600 }}>
                    📷 Receipt
                  </a>
                ) : (
                  <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: COLORS.slate400 }}>No receipt</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '16px' }}>
          <button onClick={onClose} style={{ ...modalCancelBtnStyle, width: '100%' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
