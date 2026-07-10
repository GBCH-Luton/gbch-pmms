// Portfolio-wide compliance rollup -- one row per (property x cert type)
// combination, the natural unit computeComplianceAging operates on.
// Deliberately read/navigate-only: PropertyComplianceTab.jsx (a property's
// own Compliance tab) remains the one place edits actually happen; a row
// click here just deep-links into that tab instead of duplicating any
// edit UI.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import {
  COMPLIANCE_TYPES, RagPill, computeComplianceAging, formatUKDate,
  filterSelectStyle, thStyle, tdStyle, KpiTiles,
} from './shared'

const CATEGORY_OPTIONS = ['All', 'Expired', 'Due Soon', 'No Record', 'Valid', 'N/A']

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
  const recordsByKey = {}
  records.forEach(r => { recordsByKey[`${r.property_id}:${r.cert_type}`] = r })

  const rows = []
  properties.forEach(property => {
    COMPLIANCE_TYPES.forEach(type => {
      const record = recordsByKey[`${property.id}:${type.key}`]
      const aging = computeComplianceAging(record, thresholdDays)
      rows.push({ property, type, record, aging, category: agingCategory(aging) })
    })
  })

  const kpis = [
    { label: 'Total records', value: rows.length, colour: '#64748b', tierFilter: 'All' },
    { label: 'Expired', value: rows.filter(r => r.category === 'Expired').length, colour: '#dc2626', tierFilter: 'Expired' },
    { label: 'Due Soon', value: rows.filter(r => r.category === 'Due Soon').length, colour: '#d97706', tierFilter: 'Due Soon' },
    { label: 'No Record', value: rows.filter(r => r.category === 'No Record').length, colour: '#94a3b8', tierFilter: 'No Record' },
    { label: 'Valid', value: rows.filter(r => r.category === 'Valid').length, colour: '#16a34a', tierFilter: 'Valid' },
  ]

  function applyKpiFilter(kpi) {
    clearFilters()
    setTierFilter(kpi.tierFilter || 'All')
  }

  function clearFilters() {
    setTierFilter('All')
    setCertTypeFilter('All')
    setPropertyFilter('')
  }

  const filteredRows = rows.filter(r => {
    if (tierFilter !== 'All' && r.category !== tierFilter) return false
    if (certTypeFilter !== 'All' && r.type.key !== certTypeFilter) return false
    if (propertyFilter && String(r.property.id) !== String(propertyFilter)) return false
    return true
  })

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

  const sortedRows = sortColumn
    ? [...filteredRows].sort((a, b) => {
        const va = sortValue(a, sortColumn)
        const vb = sortValue(b, sortColumn)
        if (va < vb) return sortDirection === 'asc' ? -1 : 1
        if (va > vb) return sortDirection === 'asc' ? 1 : -1
        return 0
      })
    : filteredRows

  function goToPropertyCompliance(row) {
    onNavigate?.('properties', { propertyId: row.property.id, tab: 'Compliance' })
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading compliance records...</p>
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
        <button onClick={clearFilters} style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Clear filters
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
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
                <td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '32px' }}>
                  No compliance records match these filters.
                </td>
              </tr>
            )}
            {sortedRows.map(r => (
              <tr
                key={`${r.property.id}:${r.type.key}`}
                onClick={() => goToPropertyCompliance(r)}
                style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
              >
                <td style={tdStyle}>
                  <span style={{ display: 'block', fontWeight: 700, color: '#0f172a' }}>{r.property.address}</span>
                  {r.property.postcode && <span style={{ fontSize: '12px', color: '#94a3b8' }}>{r.property.postcode}</span>}
                </td>
                <td style={tdStyle}>{r.type.title}</td>
                <td style={tdStyle}><RagPill tier={r.aging.tier} label={r.aging.label} /></td>
                <td style={tdStyle}>{r.record?.expiry_date ? formatUKDate(r.record.expiry_date) : '—'}</td>
                <td style={tdStyle}>{r.aging.daysLeft != null ? `${r.aging.daysLeft}d` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
