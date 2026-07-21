// Events: lets Compliance/Landlord Liaison (or whichever role has been
// given the "Can Create Events" permission -- see AdminAccess.jsx's
// RolesPanel) coordinate a multi-ticket situation (e.g. a landlord
// inspection) as one trackable thing. Any manager, regardless of
// division, can view every Event here and add a ticket to one (from the
// Pipeline page's "Add to Event" action) -- but nobody gets to directly
// assign a ticket to a builder from here; that stays wherever it already
// lives (Pipeline's own Reassign action).
//
// An Event's Open/Complete state is never stored -- it's always computed
// from whether every linked ticket has reached a terminal status, so it
// can't drift out of sync with the tickets it's tracking.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { attachProperties } from '../../lib/properties'
import {
  statusColour, statusLabel,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle,
} from './shared'
import PropertySearchSelect from '../../components/PropertySearchSelect'

const TERMINAL_STATUSES = ['Completed', 'Archived', 'Cancelled']

const cardStyle = { background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

function isEventComplete(tickets) {
  return tickets.length > 0 && tickets.every(t => TERMINAL_STATUSES.includes(t.status))
}

export default function AdminEvents({ profile }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createPropertyId, setCreatePropertyId] = useState('')
  const [createEventDate, setCreateEventDate] = useState('')
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState('')
  const [properties, setProperties] = useState([])

  const canCreate = profile.canCreateEvents || profile.role === 'admin'

  useEffect(() => {
    fetchEvents()
    fetchPropertiesForPicker()
  }, [])

  async function fetchPropertiesForPicker() {
    const { data } = await supabase.schema('pmms').from('properties').select('id, address').order('address')
    setProperties(data || [])
  }

  async function fetchEvents() {
    setLoading(true)
    setLoadError('')

    const { data: eventRows, error } = await supabase
      .schema('pmms')
      .from('events')
      .select('id, title, description, property_id, event_date, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setEvents([])
      setLoadError(error.message)
      setLoading(false)
      return
    }

    const withProperties = await attachProperties(eventRows, 'address')

    if (!withProperties.length) {
      setEvents([])
      setLoading(false)
      return
    }

    const { data: ticketRows } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, description, status, event_id')
      .in('event_id', withProperties.map(e => e.id))

    const enriched = withProperties.map(e => {
      const tickets = (ticketRows || []).filter(t => t.event_id === e.id)
      return { ...e, tickets, complete: isEventComplete(tickets) }
    })

    // Open events first, most recently created within each group.
    enriched.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1
      return new Date(b.created_at) - new Date(a.created_at)
    })

    setEvents(enriched)
    setLoading(false)
  }

  function openCreateModal() {
    setCreateTitle('')
    setCreateDescription('')
    setCreatePropertyId('')
    setCreateEventDate('')
    setCreateError('')
    setShowCreate(true)
  }

  async function submitCreate() {
    setCreateError('')
    if (!createTitle.trim()) { setCreateError('Enter a title.'); return }

    setCreateSaving(true)
    const { error } = await supabase
      .schema('pmms')
      .from('events')
      .insert({
        title: createTitle.trim(),
        description: createDescription.trim() || null,
        property_id: createPropertyId || null,
        event_date: createEventDate ? new Date(createEventDate).toISOString() : null,
        created_by: profile.id,
      })
    setCreateSaving(false)

    if (error) { setCreateError(error.message); return }

    setShowCreate(false)
    await fetchEvents()
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading Events...</p>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>Events</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Coordinated groups of tickets -- e.g. a landlord inspection. Any manager can add a ticket to one from the Pipeline page.</p>
        </div>
        {canCreate && (
          <button
            onClick={openCreateModal}
            style={{ padding: '10px 18px', background: '#1e3a8a', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ＋ New Event
          </button>
        )}
      </div>

      {loadError && <p style={modalErrorStyle}>{loadError}</p>}

      {events.length === 0 && !loadError && (
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No Events yet.</p>
        </div>
      )}

      {events.map(e => (
        <div key={e.id} style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{e.title}</p>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                {e.property?.address}
                {e.property?.address && e.event_date ? ' · ' : ''}
                {e.event_date ? new Date(e.event_date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
              </p>
            </div>
            <span style={{
              fontSize: '11px', fontWeight: 800, padding: '3px 10px', borderRadius: '20px', flexShrink: 0,
              color: e.complete ? '#16a34a' : '#d97706',
              background: e.complete ? '#dcfce7' : '#fef3c7',
            }}>
              {e.complete ? 'Complete' : 'Open'}
            </span>
          </div>

          {e.description && (
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#374151' }}>{e.description}</p>
          )}

          {e.tickets.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No tickets linked yet -- add one from the Pipeline page.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {e.tickets.map(t => (
                <div
                  key={t.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px' }}
                >
                  <span style={{ fontSize: '12px', color: '#374151' }}>
                    <strong>#{t.ticket_number}</strong> · {t.category}{t.description ? ` — ${t.description}` : ''}
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff', background: statusColour(t.status), padding: '2px 8px', borderRadius: '20px', flexShrink: 0 }}>
                    {statusLabel(t.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {showCreate && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>New Event</p>

            <p style={modalLabelStyle}>Title</p>
            <input type="text" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder="e.g. Landlord inspection -- 67 Victoria Road" style={inputStyle} />

            <p style={modalLabelStyle}>Property (optional)</p>
            <PropertySearchSelect properties={properties} value={createPropertyId} onChange={setCreatePropertyId} />

            <p style={modalLabelStyle}>Date &amp; time (optional)</p>
            <input type="datetime-local" value={createEventDate} onChange={(e) => setCreateEventDate(e.target.value)} style={inputStyle} />

            <p style={modalLabelStyle}>Description / agenda (optional)</p>
            <textarea
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              placeholder="What needs to happen?"
              style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
            />

            {createError && <p style={modalErrorStyle}>{createError}</p>}

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button onClick={() => setShowCreate(false)} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitCreate} disabled={createSaving} style={{ ...modalConfirmBtnStyle, opacity: createSaving ? 0.6 : 1, cursor: createSaving ? 'not-allowed' : 'pointer' }}>
                {createSaving ? 'Creating...' : 'Create Event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
