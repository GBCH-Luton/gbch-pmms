// Landlord Liaison Manager's control screen, same recipe as
// AdminHousekeeping.jsx / AdminCompliance.jsx: a division dashboard built
// from existing data rather than new tables. Two sections -- their open
// ticket queue (category = "Landlord Liaison", see
// scripts/add_landlord_liaison_division.sql) and a directory of every
// property that has landlord contact details on file (pulled from the
// existing Lease & Legal fields on pmms.properties -- see
// PropertyLeaseLegalTab.jsx). Reassignment/ticket actions aren't rebuilt
// here -- rows link out to Pipeline and to the property's Lease & Legal
// tab, both already existing, rather than duplicating that UI.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { attachProperties } from '../../lib/properties'
import {
  priorityTierLabel, priorityBadgeStyle, statusColour, statusLabel, formatUKDate, fetchPriorityThresholds,
} from './shared'

const cardStyle = { background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const sectionTitleStyle = { margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }
const sectionSubtitleStyle = { margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }

const OPEN_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']

export default function AdminLandlordLiaison({ onNavigate }) {
  const [tickets, setTickets] = useState([])
  const [directory, setDirectory] = useState([])
  const [loading, setLoading] = useState(true)
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchTickets(), fetchDirectory(), fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })])
    setLoading(false)
  }

  async function fetchTickets() {
    const { data } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, property_id, status, issue_tag, description, priority_score, created_at')
      .eq('category', 'Landlord Liaison')
      .in('status', OPEN_STATUSES)
      .order('priority_score', { ascending: false })

    setTickets(await attachProperties(data || [], 'address'))
  }

  async function fetchDirectory() {
    const { data } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address, landlord_company, landlord_name, landlord_phone, landlord_email')
      .or('landlord_company.not.is.null,landlord_name.not.is.null,landlord_phone.not.is.null,landlord_email.not.is.null')
      .order('address')

    setDirectory(data || [])
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading Landlord Liaison...</p>
    </div>
  )

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>Landlord Liaison</h1>

      <div style={cardStyle}>
        <p style={sectionTitleStyle}>Open Tickets ({tickets.length})</p>
        <p style={sectionSubtitleStyle}>Every open ticket logged under the Landlord Liaison category, highest priority first.</p>
        {tickets.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>Nothing open right now.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tickets.map(t => {
            const tier = priorityTierLabel(t.priority_score, p1Threshold, p2Threshold)
            const tierStyle = priorityBadgeStyle(tier)
            return (
              <button
                key={t.id}
                onClick={() => onNavigate?.('pipeline', { propertyId: t.property_id })}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', cursor: 'pointer', textAlign: 'left' }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>#{t.ticket_number} · {t.property?.address || 'Unknown property'}</p>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.slate900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.issue_tag || t.description || 'Unspecified issue'}</p>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: tierStyle.color, background: tierStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>{tier}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status), background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{statusLabel(t.status)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <p style={sectionTitleStyle}>Landlord Directory ({directory.length})</p>
        <p style={sectionSubtitleStyle}>Every property with landlord contact details on file. Tap one to open its Lease &amp; Legal tab.</p>
        {directory.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No landlord contact details recorded yet.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {directory.map(p => (
            <button
              key={p.id}
              onClick={() => onNavigate?.('properties', { propertyId: p.id, tab: 'Lease & Legal' })}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', cursor: 'pointer', textAlign: 'left' }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{p.address}</p>
                <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>
                  {p.landlord_company || p.landlord_name || 'No landlord name on file'}
                  {p.landlord_phone ? ` · ${p.landlord_phone}` : ''}
                </p>
              </div>
              {p.landlord_email && (
                <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.blue700, background: COLORS.blue100, padding: '3px 10px', borderRadius: '20px', flexShrink: 0 }}>{p.landlord_email}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
