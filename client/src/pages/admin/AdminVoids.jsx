// Portfolio-wide void-room rollup -- one row per currently-void room,
// sorted/filterable by how long it's been void. Deliberately read/
// navigate-only: PropertyRoomsTab.jsx (a property's own Rooms tab)
// remains the one place edits actually happen; a row click here just
// deep-links into that tab instead of duplicating any edit UI.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import {
  RagPill, computeVoidAging, formatUKDate,
  filterSelectStyle, thStyle, tdStyle, KpiTiles,
} from './shared'

const TIER_OPTIONS = ['All', 'Overdue', 'Aging', 'Recent', 'Unknown']

function voidCategory(aging) {
  if (aging.tier === 'grey') return 'Unknown'
  if (aging.tier === 'red') return 'Overdue'
  if (aging.tier === 'amber') return 'Aging'
  return 'Recent'
}

export default function AdminVoids({ onNavigate, initialTierFilter, onInitialTierFilterConsumed }) {
  const [rooms, setRooms] = useState([])
  const [properties, setProperties] = useState([])
  const [thresholdDays, setThresholdDays] = useState(45)
  const [voidHistoryCounts, setVoidHistoryCounts] = useState({ today: 0, thisWeek: 0, thisMonth: 0 })
  const [loading, setLoading] = useState(true)

  const [tierFilter, setTierFilter] = useState('All')
  const [propertyFilter, setPropertyFilter] = useState('')

  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')

  useEffect(() => {
    fetchAll()
    fetchVoidHistoryCounts()
    if (initialTierFilter) setTierFilter(initialTierFilter)
    if (initialTierFilter) onInitialTierFilterConsumed?.()
  }, [])

  // Portfolio-wide, independent of the tier/property filters below --
  // "how many rooms went void today/this week/this month" is a glance at
  // turnover velocity, distinct from the aging tiles above (which measure
  // how long currently-void rooms have sat empty). 'Moved Out' and 'Room
  // Added (Void)' are the two history actions that mean "became void"
  // (see PropertyRoomsTab.jsx) -- 'Moved In' means the opposite.
  async function fetchVoidHistoryCounts() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_room_history')
      .select('action_date')
      .in('action', ['Moved Out', 'Room Added (Void)'])

    if (error || !data) { setVoidHistoryCounts({ today: 0, thisWeek: 0, thisMonth: 0 }); return }

    const now = new Date()
    const todayIso = now.toISOString().slice(0, 10)
    const monday = new Date(now)
    const day = monday.getDay()
    monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1))
    monday.setHours(0, 0, 0, 0)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    let today = 0, thisWeek = 0, thisMonth = 0
    data.forEach(r => {
      if (!r.action_date) return
      if (r.action_date === todayIso) today += 1
      const d = new Date(r.action_date)
      if (d >= monday) thisWeek += 1
      if (d >= monthStart) thisMonth += 1
    })

    setVoidHistoryCounts({ today, thisWeek, thisMonth })
  }

  async function fetchAll() {
    setLoading(true)
    const [{ data: roomsData }, { data: propertiesData }, { data: thresholdRow }] = await Promise.all([
      supabase.schema('pmms').from('property_rooms').select('id, property_id, room_name, room_type, bed_type, current_status, void_since').eq('current_status', 'Void'),
      supabase.schema('pmms').from('properties').select('id, address, postcode').order('address'),
      supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'void_aging_threshold_days').maybeSingle(),
    ])
    setRooms(roomsData || [])
    setProperties(propertiesData || [])
    if (thresholdRow?.setting_value != null) setThresholdDays(Number(thresholdRow.setting_value))
    setLoading(false)
  }

  const propertiesById = {}
  properties.forEach(p => { propertiesById[p.id] = p })

  const rows = rooms.map(room => {
    const aging = computeVoidAging(room, thresholdDays)
    return { room, property: propertiesById[room.property_id], aging, category: voidCategory(aging) }
  }).filter(r => r.property)

  const kpis = [
    { label: 'Total Void', value: rows.length, colour: COLORS.slate500, tierFilter: 'All' },
    { label: 'Overdue', value: rows.filter(r => r.category === 'Overdue').length, colour: COLORS.red600, tierFilter: 'Overdue' },
    { label: 'Aging', value: rows.filter(r => r.category === 'Aging').length, colour: COLORS.amber600, tierFilter: 'Aging' },
    { label: 'Recent', value: rows.filter(r => r.category === 'Recent').length, colour: COLORS.green600, tierFilter: 'Recent' },
  ]

  function applyKpiFilter(kpi) {
    clearFilters()
    setTierFilter(kpi.tierFilter || 'All')
  }

  function clearFilters() {
    setTierFilter('All')
    setPropertyFilter('')
  }

  const filteredRows = rows.filter(r => {
    if (tierFilter !== 'All' && r.category !== tierFilter) return false
    if (propertyFilter && String(r.property.id) !== String(propertyFilter)) return false
    return true
  })

  function sortValue(r, column) {
    switch (column) {
      case 'property': return (r.property.address || '').toLowerCase()
      case 'room': return (r.room.room_name || '').toLowerCase()
      case 'roomType': return (r.room.room_type || '').toLowerCase()
      case 'bedType': return (r.room.bed_type || '').toLowerCase()
      case 'status': return r.category
      case 'voidSince': return r.room.void_since ? new Date(r.room.void_since).getTime() : 0
      case 'daysSince': return r.aging.daysSince ?? -Infinity
      default: return ''
    }
  }

  function toggleSort(column) {
    if (sortColumn === column) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  function sortArrow(column) {
    if (sortColumn !== column) return ''
    return sortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  const sortedRows = sortColumn
    ? [...filteredRows].sort((a, b) => {
        const va = sortValue(a, sortColumn)
        const vb = sortValue(b, sortColumn)
        if (va < vb) return sortDirection === 'asc' ? -1 : 1
        if (va > vb) return sortDirection === 'asc' ? 1 : -1
        return 0
      })
    : filteredRows

  function goToPropertyRooms(row) {
    onNavigate?.('properties', { propertyId: row.property.id, tab: 'Rooms' })
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading void rooms...</p>
    </div>
  )

  return (
    <div>
      <KpiTiles kpis={kpis} onTileClick={applyKpiFilter} />

      <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Voided Recently</p>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Voided Today', value: voidHistoryCounts.today },
          { label: 'Voided This Week', value: voidHistoryCounts.thisWeek },
          { label: 'Voided This Month', value: voidHistoryCounts.thisMonth },
        ].map(m => (
          <div key={m.label} style={{ flex: '1 1 160px', background: COLORS.slate600, borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</p>
            <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: COLORS.white }}>{m.value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={filterSelectStyle}>
          {TIER_OPTIONS.map(c => <option key={c} value={c}>{c === 'All' ? 'All Statuses' : c}</option>)}
        </select>
        <div style={{ width: '220px' }}>
          <PropertySearchSelect properties={properties} value={propertyFilter} onChange={setPropertyFilter} placeholder="All Properties" />
        </div>
        <button onClick={clearFilters} style={{ padding: '8px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Clear filters
        </button>
      </div>

      <div style={{ background: COLORS.white, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('property')}>Property{sortArrow('property')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('room')}>Room{sortArrow('room')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('roomType')}>Room Type{sortArrow('roomType')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('bedType')}>Bed Type{sortArrow('bedType')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('voidSince')}>Void Since{sortArrow('voidSince')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('daysSince')}>Days Void{sortArrow('daysSince')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: COLORS.slate400, padding: '32px' }}>
                  No void rooms match these filters.
                </td>
              </tr>
            )}
            {sortedRows.map(r => (
              <tr
                key={r.room.id}
                onClick={() => goToPropertyRooms(r)}
                style={{ borderBottom: `1px solid ${COLORS.slate100}`, cursor: 'pointer' }}
              >
                <td style={tdStyle}>
                  <span style={{ display: 'block', fontWeight: 700, color: COLORS.slate900 }}>{r.property.address}</span>
                  {r.property.postcode && <span style={{ fontSize: '12px', color: COLORS.slate400 }}>{r.property.postcode}</span>}
                </td>
                <td style={tdStyle}>{r.room.room_name}</td>
                <td style={tdStyle}>{r.room.room_type || '—'}</td>
                <td style={tdStyle}>{r.room.bed_type || '—'}</td>
                <td style={tdStyle}><RagPill tier={r.aging.tier} label={r.aging.label} /></td>
                <td style={tdStyle}>{r.room.void_since ? formatUKDate(r.room.void_since) : '—'}</td>
                <td style={tdStyle}>{r.aging.daysSince != null ? `${r.aging.daysSince}d` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
