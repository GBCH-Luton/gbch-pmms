// Utility Bills tab of the Property Profile. See
// scripts/add_property_utility_bills.sql for the properties.occupancy_type
// column + pmms.property_bills table (+ 'property-docs' storage bucket,
// already used by PropertyComplianceTab.jsx) this component depends on --
// run it before using this tab.
//
// Self Contained properties (the Service User pays their own utility bills
// directly) show a read-only banner instead of the form below -- see
// occupancy_type on properties, set from the Add/Edit Property form and
// PropertyCoreTab's own Property Details section.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { modalLabelStyle, modalErrorStyle, formatUKDate } from './shared'
import { compressImage } from '../../lib/imageCompression'
import { getSignedUrl } from '../../lib/storage'

const BILL_TYPES = ['Gas', 'Electricity', 'Water', 'Council Tax', 'Wifi', 'Other']
const PAYMENT_METHODS = ['Direct Debit', 'Card', 'Key', 'PAYG']
const BILL_TYPE_ICONS = { Gas: '🔥', Electricity: '⚡', Water: '💧', 'Council Tax': '🏛️', Wifi: '📶', Other: '📄' }
const BILL_TYPE_ICON_BG = { Gas: COLORS.amber100, Electricity: COLORS.blue100, Water: COLORS.teal100, 'Council Tax': COLORS.red100, Wifi: COLORS.blue100, Other: COLORS.slate100 }

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

function billStatus(bill) {
  const hasCredit = bill.credit_amount != null && Number(bill.credit_amount) > 0
  const hasDebt = bill.debt_amount != null && Number(bill.debt_amount) > 0
  if (hasCredit && !hasDebt) return { label: 'Credit', bg: COLORS.blue100, color: COLORS.blue700 }
  if (bill.paid_date) return { label: 'Paid', bg: COLORS.green100, color: COLORS.green600 }
  if (bill.due_date) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (new Date(bill.due_date) < today) return { label: 'Overdue', bg: COLORS.red100, color: COLORS.red600 }
  }
  return { label: 'Due', bg: COLORS.amber100, color: COLORS.amber600 }
}

function emptyDraft() {
  return {
    bill_type: 'Gas', invoice_date: '', due_date: '', invoice_start_date: '', invoice_end_date: '',
    debt_amount: '', credit_amount: '', payment_method: 'Direct Debit', paid_date: '', notes: '',
  }
}

function AddBillForm({ property, profile, onSaved }) {
  const [draft, setDraft] = useState(emptyDraft())
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key) {
    return (e) => setDraft(prev => ({ ...prev, [key]: e.target.value }))
  }

  async function handleSave() {
    if (!draft.debt_amount && !draft.credit_amount) {
      setError('Enter a debt amount or a credit amount.')
      return
    }
    setSaving(true)
    setError('')

    let invoiceFileUrl = null
    if (file) {
      let compressed
      try {
        compressed = await compressImage(file)
      } catch (compressErr) {
        setSaving(false)
        setError(compressErr.message)
        return
      }
      const path = `${property.id}/bills/${Date.now()}-${compressed.name}`
      const { error: uploadError } = await supabase.storage.from('property-docs').upload(path, compressed)
      if (uploadError) {
        setSaving(false)
        setError(`Upload failed: ${uploadError.message}`)
        return
      }
      invoiceFileUrl = await getSignedUrl('property-docs', path)
    }

    const { data, error: insertError } = await supabase
      .schema('pmms')
      .from('property_bills')
      .insert({
        property_id: property.id,
        bill_type: draft.bill_type,
        invoice_date: draft.invoice_date || null,
        due_date: draft.due_date || null,
        invoice_start_date: draft.invoice_start_date || null,
        invoice_end_date: draft.invoice_end_date || null,
        debt_amount: draft.debt_amount === '' ? null : Number(draft.debt_amount),
        credit_amount: draft.credit_amount === '' ? null : Number(draft.credit_amount),
        payment_method: draft.payment_method || null,
        paid_date: draft.paid_date || null,
        notes: draft.notes || null,
        invoice_file_url: invoiceFileUrl,
        recorded_by: profile?.id,
        recorded_by_name: profile?.name,
      })
      .select()
      .single()

    setSaving(false)
    if (insertError) { setError(insertError.message); return }

    setDraft(emptyDraft())
    setFile(null)
    onSaved(data)
  }

  return (
    <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p style={{ margin: '0 0 14px 0', fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>Add a bill</p>

      <p style={modalLabelStyle}>Bill Type</p>
      <select value={draft.bill_type} onChange={set('bill_type')} style={{ ...inputStyle, marginBottom: '14px' }}>
        {BILL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: '14px' }}>
        <div>
          <p style={modalLabelStyle}>Invoice Date</p>
          <input type="date" value={draft.invoice_date} onChange={set('invoice_date')} style={inputStyle} />
        </div>
        <div>
          <p style={modalLabelStyle}>Due Date</p>
          <input type="date" value={draft.due_date} onChange={set('due_date')} style={inputStyle} />
        </div>
        <div>
          <p style={modalLabelStyle}>Invoice Start Date</p>
          <input type="date" value={draft.invoice_start_date} onChange={set('invoice_start_date')} style={inputStyle} />
        </div>
        <div>
          <p style={modalLabelStyle}>Invoice End Date</p>
          <input type="date" value={draft.invoice_end_date} onChange={set('invoice_end_date')} style={inputStyle} />
        </div>
      </div>

      <p style={modalLabelStyle}>Invoice File</p>
      <input type="file" accept=".pdf,image/*" id="bill-file-input" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
      <button
        onClick={() => document.getElementById('bill-file-input').click()}
        style={{ width: '100%', padding: '10px 12px', marginBottom: '14px', borderRadius: '10px', border: `2px dashed ${COLORS.slate300}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
      >
        {file ? file.name : 'Upload invoice file'}
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: '14px' }}>
        <div>
          <p style={modalLabelStyle}>Invoice debt amount (£)</p>
          <input type="number" step="0.01" value={draft.debt_amount} onChange={set('debt_amount')} style={inputStyle} placeholder="0.00" />
        </div>
        <div>
          <p style={modalLabelStyle}>Invoice credit amount (£)</p>
          <input type="number" step="0.01" value={draft.credit_amount} onChange={set('credit_amount')} style={inputStyle} placeholder="only for a refund/credit" />
        </div>
        <div>
          <p style={modalLabelStyle}>Payment Method</p>
          <select value={draft.payment_method} onChange={set('payment_method')} style={inputStyle}>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <p style={modalLabelStyle}>Paid Date</p>
          <input type="date" value={draft.paid_date} onChange={set('paid_date')} style={inputStyle} />
        </div>
      </div>

      <p style={modalLabelStyle}>Notes</p>
      <textarea value={draft.notes} onChange={set('notes')} rows={2} style={{ ...inputStyle, resize: 'vertical', marginBottom: '6px' }} />

      {error && <p style={modalErrorStyle}>{error}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        style={{ marginTop: '10px', padding: '11px 22px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Saving...' : 'Save bill'}
      </button>
    </div>
  )
}

function BillCard({ bill }) {
  const status = billStatus(bill)
  const isCredit = status.label === 'Credit'
  const amount = isCredit ? bill.credit_amount : bill.debt_amount

  const metaParts = []
  if (bill.invoice_date) metaParts.push(formatUKDate(bill.invoice_date))
  if (bill.payment_method) metaParts.push(bill.payment_method)
  if (bill.due_date && status.label !== 'Paid' && !isCredit) metaParts.push(`due ${formatUKDate(bill.due_date)}`)
  if (bill.paid_date) metaParts.push(`paid ${formatUKDate(bill.paid_date)}`)

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '13px 16px', marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '220px' }}>
        <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: BILL_TYPE_ICON_BG[bill.bill_type] || COLORS.slate100, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>
          {BILL_TYPE_ICONS[bill.bill_type] || '📄'}
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>{bill.bill_type}</p>
          <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: COLORS.slate400, fontWeight: 600 }}>{metaParts.join(' · ') || '—'}</p>
          {bill.notes && <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: COLORS.slate500 }}>{bill.notes}</p>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '10.5px', fontWeight: 800, padding: '3px 10px', borderRadius: '20px', whiteSpace: 'nowrap', background: status.bg, color: status.color }}>{status.label}</span>
        <span style={{ fontSize: '14px', fontWeight: 800, color: COLORS.slate900, fontVariantNumeric: 'tabular-nums', minWidth: '70px', textAlign: 'right' }}>
          {amount != null ? `£${Number(amount).toFixed(2)}` : '—'}
        </span>
        {bill.invoice_file_url && (
          <a href={bill.invoice_file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11.5px', fontWeight: 700, color: COLORS.teal700, textDecoration: 'none' }}>Invoice</a>
        )}
      </div>
    </div>
  )
}

export default function PropertyUtilityBillsTab({ property, profile }) {
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')

  useEffect(() => {
    fetchBills()
  }, [property.id])

  async function fetchBills() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase
      .schema('pmms')
      .from('property_bills')
      .select('*')
      .eq('property_id', property.id)
      .order('invoice_date', { ascending: false, nullsFirst: false })

    if (error) { setLoadError(error.message); setBills([]); setLoading(false); return }
    setBills(data || [])
    setLoading(false)
  }

  if (property.occupancy_type === 'Self Contained') {
    return (
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '14px', padding: '18px 20px' }}>
        <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: COLORS.slate200, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🔒</div>
        <div>
          <p style={{ margin: '0 0 4px 0', fontSize: '13.5px', fontWeight: 800, color: COLORS.slate900 }}>Self-contained unit — Service User responsible</p>
          <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate500, fontWeight: 600, lineHeight: 1.55 }}>
            This property is marked Self Contained. The Service User pays their own utility bills directly, so there's nothing for GBCH to record here. Change Occupancy on the Core tab if this is incorrect.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading bills...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load bills</p>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{loadError}</p>
      </div>
    )
  }

  const thisYear = new Date().getFullYear()
  const paidThisYear = bills
    .filter(b => b.paid_date && new Date(b.paid_date).getFullYear() === thisYear && b.debt_amount)
    .reduce((sum, b) => sum + Number(b.debt_amount), 0)
  const outstanding = bills
    .filter(b => !b.paid_date && b.debt_amount)
    .reduce((sum, b) => sum + Number(b.debt_amount), 0)
  const overdueCount = bills.filter(b => billStatus(b).label === 'Overdue').length

  const visibleBills = typeFilter === 'All' ? bills : bills.filter(b => b.bill_type === typeFilter)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <div style={{ background: COLORS.slate50, borderRadius: '12px', padding: '14px 16px' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '10.5px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Paid this year</p>
          <p style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: COLORS.slate900, fontVariantNumeric: 'tabular-nums' }}>£{paidThisYear.toFixed(2)}</p>
        </div>
        <div style={{ background: COLORS.slate50, borderRadius: '12px', padding: '14px 16px' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '10.5px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outstanding</p>
          <p style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: COLORS.amber600, fontVariantNumeric: 'tabular-nums' }}>£{outstanding.toFixed(2)}</p>
        </div>
        <div style={{ background: COLORS.slate50, borderRadius: '12px', padding: '14px 16px' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '10.5px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overdue</p>
          <p style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: COLORS.red600, fontVariantNumeric: 'tabular-nums' }}>{overdueCount} bill{overdueCount === 1 ? '' : 's'}</p>
        </div>
      </div>

      <AddBillForm property={property} profile={profile} onSaved={(bill) => setBills(prev => [bill, ...prev])} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 12px', flexWrap: 'wrap', gap: '10px' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bill history</p>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ fontSize: '12px', fontWeight: 700, padding: '6px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, color: COLORS.slate600, background: COLORS.white }}>
          <option value="All">All types</option>
          {BILL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {visibleBills.length === 0 ? (
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No bills recorded yet.</p>
      ) : (
        visibleBills.map(b => <BillCard key={b.id} bill={b} />)
      )}
    </div>
  )
}
