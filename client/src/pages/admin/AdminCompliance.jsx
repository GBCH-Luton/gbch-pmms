// Portfolio-wide compliance rollup -- one row per (property x cert type)
// combination, the natural unit computeComplianceAging operates on.
// Deliberately read/navigate-only: PropertyComplianceTab.jsx (a property's
// own Compliance tab) remains the one place edits actually happen; a row
// click here just deep-links into that tab instead of duplicating any
// edit UI.

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import {
  COMPLIANCE_TYPES, RagPill, computeComplianceAging, formatUKDate,
  filterSelectStyle, thStyle, tdStyle, KpiTiles,
} from './shared'

const CATEGORY_OPTIONS = ['All', 'Expired', 'Due Soon', 'No Record', 'Valid', 'N/A']

// How many rows render at once -- more load in automatically as the user
// scrolls near the bottom (see the IntersectionObserver effect below),
// instead of a full ~1,000-row table or prev/next pagination.
const PAGE_SIZE = 50

// Groups computeComplianceAging's {tier, label} into the same 5 buckets
// the KPI tiles/dashboard count by -- 'red' covers both Expired and No
// Record, which need to stay distinguishable for filtering.
function agingCategory(aging) {
  if (aging.tier === 'grey') return 'N/A'
  if (aging.label === 'No Record') return 'No Record'
  if (aging.label === 'Expired') return 'Expired'
  if (aging.tier === 'amber') return 'Due Soon'
  return 'Valid'
}

export default function AdminCompliance({ onNavigate, initialTierFilter, onInitialTierFilterConsumed }) {
  const [properties, setProperties] = useState([])
  const [records, setRecords] = useState([])
  const [thresholdDays, setThresholdDays] = useState(90)
  const [loading, setLoading] = useState(true)

  const [tierFilter, setTierFilter] = useState('All')
  const [certTypeFilter, setCertTypeFilter] = useState('All')
  const [propertyFilter, setPropertyFilter] = useState('')

  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')

  useEffect(() => {
    fetchAll()
    if (initialTierFilter) setTierFilter(initialTierFilter)
    if (initialTierFilter) onInitialTierFilterConsumed?.()
  }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: propertiesData }, { data: recordsData }, { data: thresholdRow }] = await Promise.all([
      supabase.schema('pmms').from('properties').select('id, address, postcode').order('address'),
      supabase.schema('pmms').from('property_compliance').select('*'),
      supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'compliance_aging_threshold_days').maybeSingle(),
    ])
    setProperties(propertiesData || [])
    setRecords(recordsData || [])
    if (thresholdRow?.setting_value != null) setThresholdDays(Number(thresholdRow.setting_value))
    setLoading(false)
  }

  // Full cross-product of properties x cert types -- so a property with
  // zero property_compliance rows still contributes a "No Record" row per
  // cert type, instead of silently vanishing from the portfolio view.
  // Memoized because this (and the filter/sort below) previously reran on
  // every render -- including every keystroke in the filters -- which is
  // what made the page feel sluggish with ~150 properties x 7 cert types.
  const rows = useMemo(() => {
    const recordsByKey = {}
    records.forEach(r => { recordsByKey[`${r.property_id}:${r.cert_type}`] = r })

    const built = []
    properties.forEach(property => {
      COMPLIANCE_TYPES.forEach(type => {
        const record = recordsByKey[`${property.id}:${type.key}`]
        const aging = computeComplianceAging(record, thresholdDays)
        built.push({ property, type, record, aging, category: agingCategory(aging) })
      })
    })
    return built
  }, [properties, records, thresholdDays])

  const kpis = useMemo(() => [
    { label: 'Total records', value: rows.length, colour: COLORS.slate500, tierFilter: 'All' },
    { label: 'Expired', value: rows.filter(r => r.category === 'Expired').length, colour: COLORS.red600, tierFilter: 'Expired' },
    { label: 'Due Soon', value: rows.filter(r => r.category === 'Due Soon').length, colour: COLORS.amber600, tierFilter: 'Due Soon' },
    { label: 'No Record', value: rows.filter(r => r.category === 'No Record').length, colour: COLORS.slate400, tierFilter: 'No Record' },
    { label: 'Valid', value: rows.filter(r => r.category === 'Valid').length, colour: COLORS.green600, tierFilter: 'Valid' },
  ], [rows])

  function applyKpiFilter(kpi) {
    clearFilters()
    setTierFilter(kpi.tierFilter || 'All')
  }

  function clearFilters() {
    setTierFilter('All')
    setCertTypeFilter('All')
    setPropertyFilter('')
  }

  const filteredRows = useMemo(() => rows.filter(r => {
    if (tierFilter !== 'All' && r.category !== tierFilter) return false
    if (certTypeFilter !== 'All' && r.type.key !== certTypeFilter) return false
    if (propertyFilter && String(r.property.id) !== String(propertyFilter)) return false
    return true
  }), [rows, tierFilter, certTypeFilter, propertyFilter])

  function sortValue(r, column) {
    switch (column) {
      case 'property': return (r.property.address || '').toLowerCase()
      case 'certType': return r.type.title.toLowerCase()
      case 'status': return r.category
      case 'expiry': return r.record?.expiry_date ? new Date(r.record.expiry_date).getTime() : 0
      case 'daysLeft': return r.aging.daysLeft ?? -Infinity
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

  const sortedRows = useMemo(() => (
    sortColumn
      ? [...filteredRows].sort((a, b) => {
          const va = sortValue(a, sortColumn)
          const vb = sortValue(b, sortColumn)
          if (va < vb) return sortDirection === 'asc' ? -1 : 1
          if (va > vb) return sortDirection === 'asc' ? 1 : -1
          return 0
        })
      : filteredRows
  ), [filteredRows, sortColumn, sortDirection])

  // Infinite scroll: render a growing slice instead of all ~1,000 rows (or
  // prev/next pagination) -- resets to the first page whenever the filtered
  // set changes so a new filter doesn't start scrolled halfway down.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const sentinelRef = useRef(null)

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [tierFilter, certTypeFilter, propertyFilter, sortColumn, sortDirection])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount(v => Math.min(v + PAGE_SIZE, sortedRows.length))
      }
    }, { rootMargin: '300px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [sortedRows.length])

  const visibleRows = sortedRows.slice(0, visibleCount)
  const hasMore = visibleCount < sortedRows.length

  function goToPropertyCompliance(row) {
    onNavigate?.('properties', { propertyId: row.property.id, tab: 'Compliance' })
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading compliance records...</p>
    </div>
  )

  return (
    <div>
      <KpiTiles kpis={kpis} onTileClick={applyKpiFilter} />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={filterSelectStyle}>
          {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c === 'All' ? 'All Statuses' : c}</option>)}
        </select>
        <select value={certTypeFilter} onChange={(e) => setCertTypeFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Cert Types</option>
          {COMPLIANCE_TYPES.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
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
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('certType')}>Cert Type{sortArrow('certType')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('expiry')}>Expiry Date{sortArrow('expiry')}</th>
              <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('daysLeft')}>Days Left{sortArrow('daysLeft')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: COLORS.slate400, padding: '32px' }}>
                  No compliance records match these filters.
                </td>
              </tr>
            )}
            {visibleRows.map(r => (
              <tr
                key={`${r.property.id}:${r.type.key}`}
                onClick={() => goToPropertyCompliance(r)}
                style={{ borderBottom: `1px solid ${COLORS.slate100}`, cursor: 'pointer' }}
              >
                <td style={tdStyle}>
                  <span style={{ display: 'block', fontWeight: 700, color: COLORS.slate900 }}>{r.property.address}</span>
                  {r.property.postcode && <span style={{ fontSize: '12px', color: COLORS.slate400 }}>{r.property.postcode}</span>}
                </td>
                <td style={tdStyle}>{r.type.title}</td>
                <td style={tdStyle}><RagPill tier={r.aging.tier} label={r.aging.label} /></td>
                <td style={tdStyle}>{r.record?.expiry_date ? formatUKDate(r.record.expiry_date) : '—'}</td>
                <td style={tdStyle}>{r.aging.daysLeft != null ? `${r.aging.daysLeft}d` : '—'}</td>
              </tr>
            ))}
            {hasMore && (
              <tr>
                <td colSpan={5} ref={sentinelRef} style={{ ...tdStyle, textAlign: 'center', color: COLORS.slate400, padding: '16px' }}>
                  Loading more…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sortedRows.length > 0 && (
        <p style={{ margin: '10px 2px 0', fontSize: '12px', color: COLORS.slate400, textAlign: 'center' }}>
          Showing {visibleRows.length} of {sortedRows.length}
        </p>
      )}
    </div>
  )
}
