// pmms.properties already exists (see scripts/new_project_schema.sql) with an
// integer identity id, address, property_type, electrical_shutoff,
// gas_shutoff, safeguards, high_vulnerability, vulnerability_reason,
// created_at. The postcode + status columns used on this page are added by
// scripts/add_property_postcode_and_status.sql -- run it once against the
// project before using this page.
//
// CREATE TABLE pmms.properties (
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   address text NOT NULL,
//   postcode text,
//   property_type text,
//   status text DEFAULT 'Procured',
//   created_at timestamptz DEFAULT now()
// );

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import {
  priorityTierLabel, priorityBadgeStyle, statusColour, statusLabel, GENDER_RESTRICTION_STYLES,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, formatUKDateTime, fetchPriorityThresholds, KpiTiles,
} from './shared'
import PropertyCoreTab from './PropertyCoreTab'
import PropertyComplianceTab from './PropertyComplianceTab'
import PropertyAssetsTab from './PropertyAssetsTab'
import PropertyMaintenanceTab from './PropertyMaintenanceTab'
import PropertyLeaseLegalTab from './PropertyLeaseLegalTab'
import PropertyDocumentsTab from './PropertyDocumentsTab'
import PropertyNotesTab from './PropertyNotesTab'
import PropertyRoomsTab from './PropertyRoomsTab'
import PropertyRestrictionsTab from './PropertyRestrictionsTab'
import PropertyGardensTab from './PropertyGardensTab'
import { fetchTowns, DEFAULT_TOWNS } from '../../lib/towns'
import AttachmentMedia from '../../components/AttachmentMedia'

const PROPERTY_TYPES = ['House', 'Flat', 'HMO', 'Commercial', 'Other']
const ALL_PROFILE_TABS = ['Core', 'Compliance', 'Assets', 'Maintenance', 'Lease & Legal', 'Documents', 'Notes', 'Rooms', 'Restrictions', 'Gardens']
// Division-scoped managers only see the tabs relevant to what they
// actually do -- everything else here is out of scope for their role,
// even though the underlying RLS doesn't enforce this (see
// admin_manager_full_access on pmms.properties -- a real database-level
// restriction is a separate, parked piece of work). Falls back to
// ALL_PROFILE_TABS for an unscoped manager (e.g. Maintenance Manager) or
// any division without its own entry here.
const DIVISION_PROFILE_TABS = {
  // Cleaner assignment (Core) and gender-restriction matching (Restrictions)
  // -- everything else is Maintenance/lettings-specific.
  Housekeeping: ['Core', 'Restrictions'],
  // Certificate tracking (their core job) plus Assets -- fire alarms,
  // sprinklers, boilers etc. tie directly into compliance.
  Compliance: ['Compliance', 'Assets'],
}

const DEFAULT_NEW_PROPERTY_WINDOW_HOURS = 48

const readLabelStyle = { fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }
const readValueStyle = { fontSize: '13px', fontWeight: 600, color: COLORS.slate900, textAlign: 'right' }

function TicketDetailModal({ ticket, onClose, p1Threshold, p2Threshold }) {
  const tier = priorityTierLabel(ticket.priority_score, p1Threshold, p2Threshold)
  const tierStyle = priorityBadgeStyle(tier)

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '520px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '4px' }}>
          <p style={modalTitleStyle}>Job #{ticket.ticket_number}</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: tierStyle.color, background: tierStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>{tier}</span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(ticket.status), background: statusColour(ticket.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{statusLabel(ticket.status)}</span>
          </div>
        </div>

        <p style={{ margin: '10px 0 0 0', fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>{ticket.issue_tag || ticket.description || ticket.category}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span style={readLabelStyle}>Category</span>
            <span style={readValueStyle}>{ticket.category || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span style={readLabelStyle}>Room</span>
            <span style={readValueStyle}>{ticket.room || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span style={readLabelStyle}>Assigned Builder</span>
            <span style={readValueStyle}>{ticket.builderName || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span style={readLabelStyle}>Priority Score</span>
            <span style={readValueStyle}>{ticket.priority_score ?? '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span style={readLabelStyle}>Mileage Logged</span>
            <span style={readValueStyle}>{ticket.mileage_logged ?? 0}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
            <span style={readLabelStyle}>Raised</span>
            <span style={readValueStyle}>{ticket.created_at ? formatUKDateTime(ticket.created_at) : '—'}</span>
          </div>
          {ticket.completed_at && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={readLabelStyle}>Completed</span>
              <span style={readValueStyle}>{formatUKDateTime(ticket.completed_at)}</span>
            </div>
          )}
        </div>

        {ticket.no_access_flag && (
          <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}` }}>
            <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: COLORS.slate500 }}>🚪 Couldn't get access on a previous visit</p>
          </div>
        )}

        {ticket.status === 'On Hold' && (ticket.hold_reason || ticket.hold_note) && (
          <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}` }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Why this job is paused</p>
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.amber900 }}>{ticket.hold_reason}{ticket.hold_note ? ` — ${ticket.hold_note}` : ''}</p>
          </div>
        )}

        {ticket.completion_note && (
          <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', background: COLORS.green50, border: `1px solid ${COLORS.green200}` }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.green800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Completion Note</p>
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.green900 }}>{ticket.completion_note}</p>
          </div>
        )}

        {(ticket.completion_photo_url || ticket.photo_url) && (
          <AttachmentMedia
            url={ticket.completion_photo_url || ticket.photo_url}
            alt="Ticket"
            style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', borderRadius: '10px', display: 'block', marginTop: '14px' }}
          />
        )}

        <div style={{ marginTop: '16px' }}>
          <button onClick={onClose} style={{ ...modalCancelBtnStyle, width: '100%' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

export default function AdminProperties({ profile, initialPropertiesFilter, onPropertiesFilterConsumed }) {
  const [properties, setProperties] = useState([])
  const [openTicketCounts, setOpenTicketCounts] = useState({})
  const [voidRoomCounts, setVoidRoomCounts] = useState({})
  const [newPropertyWindowHours, setNewPropertyWindowHours] = useState(DEFAULT_NEW_PROPERTY_WINDOW_HOURS)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'newProperties' | 'procured' | 'live' | 'inactive' | 'gardensOverdue'
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [towns, setTowns] = useState(DEFAULT_TOWNS)
  const [townFilter, setTownFilter] = useState('')

  const [selectedProperty, setSelectedProperty] = useState(null)
  const [activeTab, setActiveTab] = useState('Core')
  const [selectedOpenTickets, setSelectedOpenTickets] = useState([])
  const [ticketsSectionOpen, setTicketsSectionOpen] = useState(false)
  const [showAllOpenTickets, setShowAllOpenTickets] = useState(false)
  const [ticketDetailModal, setTicketDetailModal] = useState(null)
  const OPEN_TICKETS_PREVIEW_COUNT = 10
  const [editing, setEditing] = useState(false)
  const [editAddress, setEditAddress] = useState('')
  const [editPostcode, setEditPostcode] = useState('')
  const [editTown, setEditTown] = useState('')
  const [editType, setEditType] = useState('House')
  const [editStatus, setEditStatus] = useState('Procured')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const [showAddModal, setShowAddModal] = useState(false)
  const [addAddress, setAddAddress] = useState('')
  const [addPostcode, setAddPostcode] = useState('')
  const [addTown, setAddTown] = useState('')
  const [addType, setAddType] = useState('House')
  const [addStatus, setAddStatus] = useState('Procured')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    fetchNewPropertyWindow()
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
    fetchTowns().then(setTowns)

    fetchProperties().then((fetched) => {
      if (initialPropertiesFilter?.propertyId) {
        const match = fetched.find(p => String(p.id) === String(initialPropertiesFilter.propertyId))
        if (match) {
          setSelectedProperty(match)
          setActiveTab(initialPropertiesFilter.tab || 'Compliance')
        }
        onPropertiesFilterConsumed?.()
      }
    })

    if (initialPropertiesFilter?.mode) {
      setFilterMode(initialPropertiesFilter.mode)
      onPropertiesFilterConsumed?.()
    }
    // Only meant to run once on mount, same as the rest of this app's
    // "consume an initial filter passed down from the dashboard" pattern
    // (see AdminPipeline.jsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchNewPropertyWindow() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'new_property_window_hours')
      .maybeSingle()

    if (!error && data?.setting_value != null) setNewPropertyWindowHours(Number(data.setting_value))
  }

  async function fetchProperties() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .schema('pmms')
      .from('properties')
      .select('*')
      .order('address')

    if (error) {
      setProperties([])
      setLoadError(error.message)
      setLoading(false)
      return []
    }

    setProperties(data || [])
    await fetchOpenTicketCounts(data.map(p => p.id))
    await fetchVoidRoomCounts(data.map(p => p.id))
    setLoading(false)
    return data || []
  }

  async function fetchOpenTicketCounts(propertyIds) {
    if (propertyIds.length === 0) { setOpenTicketCounts({}); return }

    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('property_id')
      .in('property_id', propertyIds)
      .not('status', 'in', '("Completed","Archived","Cancelled")')

    if (error || !data) { setOpenTicketCounts({}); return }

    const counts = {}
    data.forEach(t => { counts[t.property_id] = (counts[t.property_id] || 0) + 1 })
    setOpenTicketCounts(counts)
  }

  async function fetchVoidRoomCounts(propertyIds) {
    if (propertyIds.length === 0) { setVoidRoomCounts({}); return }

    const { data, error } = await supabase
      .schema('pmms')
      .from('property_rooms')
      .select('property_id, current_status')
      .in('property_id', propertyIds)
      .eq('current_status', 'Void')

    if (error || !data) { setVoidRoomCounts({}); return }

    const counts = {}
    data.forEach(r => { counts[r.property_id] = (counts[r.property_id] || 0) + 1 })
    setVoidRoomCounts(counts)
  }

  async function openProfile(property) {
    setSelectedProperty(property)
    setActiveTab('Core')
    setEditing(false)
    setEditAddress(property.address || '')
    setEditPostcode(property.postcode || '')
    setEditTown(property.town || '')
    setEditType(property.property_type || 'House')
    setEditStatus(property.status || 'Procured')
    setEditError('')
    setTicketsSectionOpen(false)
    setShowAllOpenTickets(false)
    setTicketDetailModal(null)

    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, ticket_number, status, category, description, issue_tag, room, priority_score, mileage_logged,
        no_access_flag, hold_reason, hold_note, completion_note, photo_url, completion_photo_url,
        created_at, completed_at, assigned_builder_id
      `)
      .eq('property_id', property.id)
      .not('status', 'in', '("Completed","Archived","Cancelled")')
      .order('priority_score', { ascending: false })

    if (error || !data) { setSelectedOpenTickets([]); return }

    const builderIds = [...new Set(data.map(t => t.assigned_builder_id).filter(Boolean))]
    let builderNameById = {}
    if (builderIds.length > 0) {
      const { data: staffData } = await supabase.from('staff').select('id, name').in('id', builderIds)
      builderNameById = Object.fromEntries((staffData || []).map(s => [s.id, s.name]))
    }

    setSelectedOpenTickets(data.map(t => ({ ...t, builderName: builderNameById[t.assigned_builder_id] })))
  }

  function closeProfile() {
    setSelectedProperty(null)
    setSelectedOpenTickets([])
    setEditing(false)
    setTicketsSectionOpen(false)
    setShowAllOpenTickets(false)
    setTicketDetailModal(null)
  }

  function handleCoreFieldsSaved(fields) {
    setSelectedProperty(prev => ({ ...prev, ...fields }))
    setProperties(prev => prev.map(p => p.id === selectedProperty.id ? { ...p, ...fields } : p))
  }

  async function saveEdit() {
    setEditError('')
    if (!editAddress.trim()) { setEditError('Address is required.'); return }

    setEditSaving(true)
    const { error } = await supabase
      .schema('pmms')
      .from('properties')
      .update({
        address: editAddress.trim(),
        postcode: editPostcode.trim() || null,
        town: editTown || null,
        property_type: editType,
        status: editStatus,
      })
      .eq('id', selectedProperty.id)

    setEditSaving(false)

    if (error) { setEditError(error.message); return }

    const updated = { ...selectedProperty, address: editAddress.trim(), postcode: editPostcode.trim() || null, town: editTown || null, property_type: editType, status: editStatus }
    setSelectedProperty(updated)
    setProperties(prev => prev.map(p => p.id === updated.id ? updated : p))
    setEditing(false)
  }

  function openAddModal() {
    setAddAddress('')
    setAddPostcode('')
    setAddTown('')
    setAddType('House')
    setAddStatus('Procured')
    setAddError('')
    setShowAddModal(true)
  }

  async function submitAdd() {
    setAddError('')
    if (!addAddress.trim()) { setAddError('Address is required.'); return }

    setAddSaving(true)
    const { error } = await supabase
      .schema('pmms')
      .from('properties')
      .insert({
        address: addAddress.trim(),
        postcode: addPostcode.trim() || null,
        town: addTown || null,
        property_type: addType,
        status: addStatus,
      })

    setAddSaving(false)

    if (error) { setAddError(error.message); return }

    setShowAddModal(false)
    await fetchProperties()
  }

  function isNewProperty(p) {
    if (!p.created_at) return false
    const cutoff = Date.now() - newPropertyWindowHours * 3600000
    return new Date(p.created_at).getTime() >= cutoff
  }

  const filteredProperties = properties.filter(p => {
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const matches = (p.address || '').toLowerCase().includes(q) || (p.postcode || '').toLowerCase().includes(q) || (p.town || '').toLowerCase().includes(q)
      if (!matches) return false
    }
    if (townFilter && p.town !== townFilter) return false
    // Inactive properties are no longer with the company -- hidden from
    // every other view (including the default "all") so they don't clutter
    // normal browsing, only reachable via the dedicated Inactive tile.
    if (filterMode !== 'inactive' && p.status === 'Inactive') return false
    if (filterMode === 'newProperties' && !isNewProperty(p)) return false
    if (filterMode === 'procured' && p.status !== 'Procured') return false
    if (filterMode === 'live' && p.status !== 'Live') return false
    if (filterMode === 'inactive' && p.status !== 'Inactive') return false
    if (filterMode === 'gardensOverdue' && !p.has_garden) return false
    return true
  })

  const filterModeLabel =
    filterMode === 'newProperties' ? 'New Properties' :
    filterMode === 'procured' ? 'Procured' :
    filterMode === 'live' ? 'Live' :
    filterMode === 'inactive' ? 'Inactive' :
    filterMode === 'gardensOverdue' ? 'Gardens' :
    null

  // Combines the KPI-tile filter and the town filter into one label so the
  // existing "Showing: ... (count)" banner also covers a town selection,
  // instead of adding a second separate count display next to the dropdown.
  const activeFilterLabel = [filterModeLabel, townFilter].filter(Boolean).join(' · ') || null

  // Same 4 metrics/colours as the dashboard's Properties tiles, plus a 5th
  // Inactive tile (page-local, not mirrored on the dashboard). Total
  // deliberately excludes Inactive so the headline number reflects only
  // properties still actively managed -- Inactive ones are no longer with
  // the company (returned to landlord etc.) and are only reachable via
  // their own tile/filter.
  const propertyKpis = [
    { label: 'Total Properties', value: properties.filter(p => p.status !== 'Inactive').length, colour: COLORS.blue600, mode: 'all' },
    { label: 'New Properties', value: properties.filter(isNewProperty).length, colour: COLORS.teal700, mode: 'newProperties' },
    { label: 'Procured', value: properties.filter(p => p.status === 'Procured').length, colour: COLORS.slate500, mode: 'procured' },
    { label: 'Live', value: properties.filter(p => p.status === 'Live').length, colour: COLORS.green600, mode: 'live' },
    { label: 'Inactive', value: properties.filter(p => p.status === 'Inactive').length, colour: COLORS.stone600, mode: 'inactive' },
  ]

  const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

  const statusPillStyle = (status) => {
    if (status === 'Void') return { fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: COLORS.red600, background: COLORS.red100 }
    if (status === 'Procured') return { fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: COLORS.slate500, background: COLORS.slate100 }
    if (status === 'Inactive') return { fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: COLORS.stone600, background: COLORS.stone200 }
    return { fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: COLORS.green600, background: COLORS.green100 } // Occupied / Live
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading properties...</p>
    </div>
  )

  // ---------------------------------------------------------------------
  // Detail panel
  // ---------------------------------------------------------------------
  if (selectedProperty) {
    return (
      <div>
        <button onClick={closeProfile} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer', marginBottom: '16px' }}>
          ← Back to Properties
        </button>

        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {!editing ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>{selectedProperty.address}</h1>
                    <span style={statusPillStyle(selectedProperty.status)}>{selectedProperty.status || 'Procured'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {selectedProperty.property_type && (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.blue700, background: COLORS.blue100, padding: '3px 10px', borderRadius: '20px' }}>{selectedProperty.property_type}</span>
                    )}
                    {selectedProperty.staff_gender_restriction && (
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                        color: GENDER_RESTRICTION_STYLES[selectedProperty.staff_gender_restriction]?.color || COLORS.slate500,
                        background: GENDER_RESTRICTION_STYLES[selectedProperty.staff_gender_restriction]?.bg || COLORS.slate100,
                      }}>
                        {selectedProperty.staff_gender_restriction}
                      </span>
                    )}
                    {selectedProperty.town && (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.teal700, background: COLORS.teal100, padding: '3px 10px', borderRadius: '20px' }}>{selectedProperty.town}</span>
                    )}
                    {selectedProperty.postcode && (
                      <span style={{ fontSize: '13px', color: COLORS.slate500 }}>{selectedProperty.postcode}</span>
                    )}
                  </div>
                </div>
                {/* Address/postcode/town/type/status aren't any division-scoped
                    manager's data to change -- same reasoning as the tab
                    restriction below, just a separate surface that bypassed it. */}
                {!profile.division && (
                  <button
                    onClick={() => setEditing(true)}
                    style={{ padding: '8px 16px', background: COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p style={modalLabelStyle}>Address</p>
              <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} style={inputStyle} />

              <p style={modalLabelStyle}>Postcode</p>
              <input type="text" value={editPostcode} onChange={(e) => setEditPostcode(e.target.value)} style={inputStyle} />

              <p style={modalLabelStyle}>Town / City</p>
              <select value={editTown} onChange={(e) => setEditTown(e.target.value)} style={inputStyle}>
                <option value="">Not set</option>
                {towns.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              <p style={modalLabelStyle}>Property Type</p>
              <select value={editType} onChange={(e) => setEditType(e.target.value)} style={inputStyle}>
                {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              <p style={modalLabelStyle}>Status</p>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={inputStyle}>
                <option value="Occupied">Occupied</option>
                <option value="Void">Void</option>
                <option value="Procured">Procured</option>
                <option value="Live">Live</option>
                <option value="Inactive">Inactive</option>
              </select>

              {editError && <p style={modalErrorStyle}>{editError}</p>}

              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={() => setEditing(false)} style={modalCancelBtnStyle}>Cancel</button>
                <button onClick={saveEdit} disabled={editSaving} style={{ ...modalConfirmBtnStyle, opacity: editSaving ? 0.6 : 1, cursor: editSaving ? 'not-allowed' : 'pointer' }}>
                  {editSaving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </div>

        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <button
            onClick={() => setTicketsSectionOpen(prev => !prev)}
            style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', padding: 0, margin: ticketsSectionOpen ? '0 0 14px 0' : 0, cursor: 'pointer', textAlign: 'left' }}
          >
            <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Open Tickets ({selectedOpenTickets.length})
            </p>
            <span style={{ fontSize: '12px', color: COLORS.slate400, fontWeight: 700 }}>{ticketsSectionOpen ? '▲ Collapse' : '▼ Expand'}</span>
          </button>

          {ticketsSectionOpen && (
            selectedOpenTickets.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No open tickets for this property.</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {(showAllOpenTickets ? selectedOpenTickets : selectedOpenTickets.slice(0, OPEN_TICKETS_PREVIEW_COUNT)).map(t => {
                    const tier = priorityTierLabel(t.priority_score, p1Threshold, p2Threshold)
                    const tierStyle = priorityBadgeStyle(tier)
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTicketDetailModal(t)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px',
                          border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', flexWrap: 'wrap', background: COLORS.white, cursor: 'pointer', width: '100%', textAlign: 'left',
                        }}
                      >
                        <div style={{ minWidth: '200px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>#{t.ticket_number}</span>{' '}
                          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{t.issue_tag || t.description || t.category}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: tierStyle.color, background: tierStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>{tier}</span>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status), background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{statusLabel(t.status)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {selectedOpenTickets.length > OPEN_TICKETS_PREVIEW_COUNT && (
                  <button
                    onClick={() => setShowAllOpenTickets(prev => !prev)}
                    style={{ marginTop: '12px', width: '100%', padding: '10px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', color: COLORS.teal700, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    {showAllOpenTickets ? 'Show fewer' : `Show all ${selectedOpenTickets.length} tickets`}
                  </button>
                )}
              </>
            )
          )}
        </div>

        {ticketDetailModal && (
          <TicketDetailModal ticket={ticketDetailModal} onClose={() => setTicketDetailModal(null)} p1Threshold={p1Threshold} p2Threshold={p2Threshold} />
        )}

        {/* Property Profile tabs */}
        {(() => {
          const profileTabs = DIVISION_PROFILE_TABS[profile.division] || ALL_PROFILE_TABS
          // Falls back to the first tab this role is actually scoped to if
          // the current selection isn't in that list -- covers both a stale
          // tab left over from before a role change, and
          // initialPropertiesFilter's own 'Compliance' default (used when
          // navigating in without an explicit tab) landing on something now
          // hidden. NOT hardcoded to 'Core' -- that's not even in every
          // role's list (e.g. Compliance Manager's is ['Compliance', 'Assets']).
          const effectiveActiveTab = profileTabs.includes(activeTab) ? activeTab : profileTabs[0]
          return (
            <>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap', borderBottom: `1px solid ${COLORS.slate200}` }}>
                {profileTabs.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '10px 16px', background: 'none', border: 'none', borderBottom: effectiveActiveTab === tab ? `2px solid ${COLORS.teal700}` : '2px solid transparent',
                      color: effectiveActiveTab === tab ? COLORS.teal700 : COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer', marginBottom: '-1px',
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {effectiveActiveTab === 'Core' ? (
                <PropertyCoreTab property={selectedProperty} onFieldsSaved={handleCoreFieldsSaved} profile={profile} />
              ) : effectiveActiveTab === 'Compliance' ? (
                <PropertyComplianceTab property={selectedProperty} />
              ) : effectiveActiveTab === 'Assets' ? (
                <PropertyAssetsTab property={selectedProperty} />
              ) : effectiveActiveTab === 'Maintenance' ? (
                <PropertyMaintenanceTab property={selectedProperty} />
              ) : effectiveActiveTab === 'Lease & Legal' ? (
                <PropertyLeaseLegalTab property={selectedProperty} onFieldsSaved={handleCoreFieldsSaved} />
              ) : effectiveActiveTab === 'Documents' ? (
                <PropertyDocumentsTab property={selectedProperty} profile={profile} />
              ) : effectiveActiveTab === 'Notes' ? (
                <PropertyNotesTab property={selectedProperty} profile={profile} />
              ) : effectiveActiveTab === 'Rooms' ? (
                <PropertyRoomsTab property={selectedProperty} />
              ) : effectiveActiveTab === 'Restrictions' ? (
                <PropertyRestrictionsTab property={selectedProperty} onFieldsSaved={handleCoreFieldsSaved} readOnly={profile.division === 'Housekeeping'} />
              ) : effectiveActiveTab === 'Gardens' ? (
                <PropertyGardensTab property={selectedProperty} onFieldsSaved={handleCoreFieldsSaved} />
              ) : null}
            </>
          )
        })()}
      </div>
    )
  }

  // ---------------------------------------------------------------------
  // Property list
  // ---------------------------------------------------------------------
  return (
    <div>
      <KpiTiles kpis={propertyKpis} onTileClick={(kpi) => setFilterMode(kpi.mode)} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by property name or postcode..."
          style={{ flex: '1 1 260px', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
        />
        <select
          value={townFilter}
          onChange={(e) => setTownFilter(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
        >
          <option value="">All Towns</option>
          {towns.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {/* Procuring a brand-new property is Maintenance/Admin territory,
            same reasoning as the per-property Edit button above. */}
        {!profile.division && (
          <button
            onClick={openAddModal}
            style={{ padding: '10px 18px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ＋ Add Property
          </button>
        )}
      </div>

      {activeFilterLabel && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: COLORS.teal50, border: `1px solid ${COLORS.teal300}`, borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.teal700 }}>Showing: {activeFilterLabel} ({filteredProperties.length})</span>
          <button
            onClick={() => { setFilterMode('all'); setTownFilter('') }}
            style={{ background: 'none', border: 'none', color: COLORS.teal700, fontSize: '13px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
          >
            Clear filter
          </button>
        </div>
      )}

      {loadError ? (
        <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load properties</p>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{loadError}</p>
        </div>
      ) : filteredProperties.length === 0 ? (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No properties found.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredProperties.map(p => {
            const isNew = isNewProperty(p)
            const voidCount = voidRoomCounts[p.id] || 0
            return (
              <div
                key={p.id}
                style={{
                  background: COLORS.white, borderRadius: '12px', padding: '10px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  display: 'flex', alignItems: 'center', gap: '14px',
                  borderLeft: isNew ? `4px solid ${COLORS.teal600}` : '4px solid transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: COLORS.slate900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.address}</span>
                  {p.property_type && (
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, color: COLORS.blue700, background: COLORS.blue100, padding: '2px 8px', borderRadius: '20px' }}>{p.property_type}</span>
                  )}
                  {isNew && (
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, color: COLORS.teal600, background: COLORS.teal100, padding: '2px 8px', borderRadius: '20px' }}>New</span>
                  )}
                  {voidCount > 0 && (
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, color: COLORS.amber600, background: COLORS.amber100, padding: '2px 8px', borderRadius: '20px' }}>
                      {voidCount} Void{voidCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {p.town && (
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, color: COLORS.teal700, background: COLORS.teal100, padding: '2px 8px', borderRadius: '20px' }}>{p.town}</span>
                  )}
                  <span style={{ flexShrink: 0, fontSize: '13px', color: COLORS.slate500 }}>{p.postcode || '—'}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexShrink: 0 }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: (openTicketCounts[p.id] || 0) > 0 ? COLORS.red600 : COLORS.green600, whiteSpace: 'nowrap' }}>
                    Open Tickets: {openTicketCounts[p.id] || 0}
                  </span>
                  <button
                    onClick={() => openProfile(p)}
                    style={{ padding: '7px 16px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    View Profile
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAddModal && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Add Property</p>

            <p style={modalLabelStyle}>Address</p>
            <input type="text" value={addAddress} onChange={(e) => setAddAddress(e.target.value)} placeholder="e.g. 12 Elm Street" style={inputStyle} />

            <p style={modalLabelStyle}>Postcode</p>
            <input type="text" value={addPostcode} onChange={(e) => setAddPostcode(e.target.value)} placeholder="e.g. B1 1AA" style={inputStyle} />

            <p style={modalLabelStyle}>Town / City</p>
            <select value={addTown} onChange={(e) => setAddTown(e.target.value)} style={inputStyle}>
              <option value="">Not set</option>
              {towns.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <p style={modalLabelStyle}>Property Type</p>
            <select value={addType} onChange={(e) => setAddType(e.target.value)} style={inputStyle}>
              {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <p style={modalLabelStyle}>Status</p>
            <select value={addStatus} onChange={(e) => setAddStatus(e.target.value)} style={inputStyle}>
              <option value="Procured">Procured</option>
              <option value="Live">Live</option>
              <option value="Inactive">Inactive</option>
            </select>

            {addError && <p style={modalErrorStyle}>{addError}</p>}

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button onClick={() => setShowAddModal(false)} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitAdd} disabled={addSaving} style={{ ...modalConfirmBtnStyle, opacity: addSaving ? 0.6 : 1, cursor: addSaving ? 'not-allowed' : 'pointer' }}>
                {addSaving ? 'Saving...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
