// Restrictions tab of the Property Profile. See
// scripts/add_property_gender_restriction_column.sql for the
// pmms.properties column this component depends on -- run it before using
// this tab.
//
// ALTER TABLE pmms.properties ADD COLUMN IF NOT EXISTS staff_gender_restriction text;
//
// Values: 'Male Only' / 'Female Only' / 'Both' / null (not set). Drives the
// restriction badge shown in the property profile header (see
// AdminProperties.jsx) so it's visible regardless of which tab is open.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { modalLabelStyle, modalErrorStyle, GENDER_RESTRICTION_OPTIONS, GENDER_RESTRICTION_STYLES } from './shared'

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }
const readRowStyle = { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0' }
const readLabelStyle = { fontSize: '12px', fontWeight: 700, color: '#94a3b8' }

export default function PropertyRestrictionsTab({ property, onFieldsSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(property.staff_gender_restriction || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startEdit() {
    setValue(property.staff_gender_restriction || '')
    setError('')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setError('')

    const { error: updateError } = await supabase
      .from('properties')
      .update({ staff_gender_restriction: value || null })
      .eq('id', property.id)

    setSaving(false)

    if (updateError) { setError(updateError.message); return }

    onFieldsSaved({ staff_gender_restriction: value || null })
    setEditing(false)
  }

  const currentStyle = GENDER_RESTRICTION_STYLES[property.staff_gender_restriction]

  return (
    <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Support Worker Restrictions</p>
        {!editing && (
          <button
            onClick={startEdit}
            style={{ padding: '6px 14px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Edit
          </button>
        )}
      </div>

      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
        Some residents have a gender preference for the support worker who visits the property. Set that here so it's visible to anyone assigning or attending a job.
      </p>

      {!editing ? (
        <div style={readRowStyle}>
          <span style={readLabelStyle}>Staff Gender Restriction</span>
          {property.staff_gender_restriction ? (
            <span style={{ fontSize: '11px', fontWeight: 800, color: currentStyle.color, background: currentStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>
              {property.staff_gender_restriction}
            </span>
          ) : (
            <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Not set</span>
          )}
        </div>
      ) : (
        <div>
          <p style={modalLabelStyle}>Staff Gender Restriction</p>
          <select value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle}>
            <option value="">Not set</option>
            {GENDER_RESTRICTION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          {error && <p style={modalErrorStyle}>{error}</p>}

          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={() => setEditing(false)} style={{ flex: 1, padding: '10px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              style={{ flex: 2, padding: '10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
