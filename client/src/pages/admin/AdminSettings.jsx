import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { DEFAULT_COMPLIANCE_CHECK_TYPES } from '../../lib/compliance'
import { DEFAULT_MAINTENANCE_CATEGORIES, migrateLegacyArrayShape } from '../../lib/maintenanceCategories'

const CATEGORY_OPTIONS = ['Electricity', 'Plumbing', 'Doors/Locks', 'Other / Unlisted Trade']

const cardStyle = { background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const cardHeadingStyle = { margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }
const cardSubtextStyle = { margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }
const fieldLabelStyle = { display: 'block', margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
const inputStyle = { width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }
const saveBtnStyle = { padding: '10px 20px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
const savedTagStyle = { marginLeft: '10px', fontSize: '12px', fontWeight: 700, color: '#16a34a' }

const SECTION_IDS = ['priority-thresholds', 'issue-scores', 'compliance-types', 'clocking-rules', 'on-call-roster', 'dashboard-metrics']

function SettingsSection({ title, subtitle, headerExtra, open, onToggle, children }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <button
          onClick={onToggle}
          style={{ display: 'flex', flex: 1, minWidth: 0, alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <div>
            <p style={cardHeadingStyle}>{title}</p>
            <p style={{ ...cardSubtextStyle, marginBottom: open ? '16px' : 0 }}>{subtitle}</p>
          </div>
          <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {open ? '▲ Collapse' : '▼ Expand'}
          </span>
        </button>
        {headerExtra && <div style={{ flexShrink: 0 }}>{headerExtra}</div>}
      </div>
      {open && children}
    </div>
  )
}

export default function AdminSettings() {
  const [loading, setLoading] = useState(true)
  const [openSections, setOpenSections] = useState({})

  function toggleSection(id) {
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function expandAll() {
    setOpenSections(Object.fromEntries(SECTION_IDS.map(id => [id, true])))
  }

  function collapseAll() {
    setOpenSections({})
  }

  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [thresholdsSaving, setThresholdsSaving] = useState(false)
  const [thresholdsSaved, setThresholdsSaved] = useState(false)

  const [maintenanceCategories, setMaintenanceCategories] = useState(DEFAULT_MAINTENANCE_CATEGORIES)
  const [categoryRenameDrafts, setCategoryRenameDrafts] = useState({})
  const [pendingFocusSubKey, setPendingFocusSubKey] = useState(null)
  const subCategoryInputRefs = useRef({})

  const [complianceTypes, setComplianceTypes] = useState(DEFAULT_COMPLIANCE_CHECK_TYPES)
  const [addingType, setAddingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [pendingFocusItemId, setPendingFocusItemId] = useState(null)
  const itemInputRefs = useRef({})

  const [clockOverrunHours, setClockOverrunHours] = useState(8)
  const [doneWindowHours, setDoneWindowHours] = useState(24)
  const [clockDistanceThresholdM, setClockDistanceThresholdM] = useState(250)
  const [clockingSaving, setClockingSaving] = useState(false)
  const [clockingSaved, setClockingSaved] = useState(false)

  const [roster, setRoster] = useState([])
  const [rosterSaving, setRosterSaving] = useState(false)
  const [rosterSaved, setRosterSaved] = useState(false)

  const [newPropertyWindowHours, setNewPropertyWindowHours] = useState(48)
  const [dashboardMetricsSaving, setDashboardMetricsSaving] = useState(false)
  const [dashboardMetricsSaved, setDashboardMetricsSaved] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_key, setting_value')

    if (!error && data) {
      const map = {}
      data.forEach(row => { map[row.setting_key] = row.setting_value })

      if (map.priority_threshold_p1 != null) setP1Threshold(map.priority_threshold_p1)
      if (map.priority_threshold_p2 != null) setP2Threshold(map.priority_threshold_p2)
      if (map.maintenance_categories) {
        const raw = map.maintenance_categories
        if (Array.isArray(raw)) {
          setMaintenanceCategories(migrateLegacyArrayShape(raw))
        } else if (raw && Object.keys(raw).length > 0) {
          setMaintenanceCategories(raw)
        }
      }
      if (map.compliance_check_types) {
        const raw = map.compliance_check_types
        if (Array.isArray(raw)) {
          setComplianceTypes(raw)
        } else {
          // Legacy shape was a plain { name: enabled } map — migrate onto the known defaults.
          setComplianceTypes(DEFAULT_COMPLIANCE_CHECK_TYPES.map(def => ({
            ...def,
            enabled: raw[def.name] != null ? raw[def.name] : def.enabled,
          })))
        }
      }
      if (map.clock_overrun_hours != null) setClockOverrunHours(map.clock_overrun_hours)
      if (map.done_window_hours != null) setDoneWindowHours(map.done_window_hours)
      if (map.clock_distance_threshold_meters != null) setClockDistanceThresholdM(map.clock_distance_threshold_meters)
      if (map.on_call_roster) setRoster(map.on_call_roster)
      if (map.new_property_window_hours != null) setNewPropertyWindowHours(map.new_property_window_hours)
    }
    setLoading(false)
  }

  async function saveSetting(key, value) {
    const { error } = await supabase
      .schema('pmms')
      .from('settings')
      .upsert({ setting_key: key, setting_value: value, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' })

    return error
  }

  async function saveThresholds() {
    setThresholdsSaving(true)
    setThresholdsSaved(false)
    await saveSetting('priority_threshold_p1', Number(p1Threshold))
    await saveSetting('priority_threshold_p2', Number(p2Threshold))
    setThresholdsSaving(false)
    setThresholdsSaved(true)
    setTimeout(() => setThresholdsSaved(false), 2000)
  }

  function persistMaintenanceCategories(updated) {
    saveSetting('maintenance_categories', updated)
  }

  function toggleCategoryEnabled(key) {
    const updated = { ...maintenanceCategories, [key]: { ...maintenanceCategories[key], enabled: !maintenanceCategories[key].enabled } }
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
  }

  function handleCategoryNameChange(key, value) {
    setCategoryRenameDrafts(prev => ({ ...prev, [key]: value }))
  }

  function handleCategoryNameBlur(key) {
    const draft = categoryRenameDrafts[key]
    setCategoryRenameDrafts(prev => { const next = { ...prev }; delete next[key]; return next })
    if (draft == null) return

    const newName = draft.trim()
    if (!newName || newName === key) return
    if (maintenanceCategories[newName]) return // name collision -- silently revert rather than overwrite another category

    const updated = {}
    Object.entries(maintenanceCategories).forEach(([k, v]) => { updated[k === key ? newName : k] = v })
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
  }

  function handleCategoryWeightChange(key, value) {
    setMaintenanceCategories(prev => ({ ...prev, [key]: { ...prev[key], weight: value } }))
  }

  function handleCategoryFieldBlur() {
    persistMaintenanceCategories(maintenanceCategories)
  }

  function removeCategory(key) {
    if (!window.confirm(`Remove "${key}"? This can't be undone.`)) return
    const updated = { ...maintenanceCategories }
    delete updated[key]
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
  }

  function addCategory() {
    let name = 'New Category'
    let n = 2
    while (maintenanceCategories[name]) { name = `New Category ${n}`; n += 1 }
    const updated = { ...maintenanceCategories, [name]: { enabled: true, weight: 50, subCategories: [] } }
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
  }

  function addSubCategory(key) {
    const newIndex = maintenanceCategories[key].subCategories.length
    const updated = {
      ...maintenanceCategories,
      [key]: { ...maintenanceCategories[key], subCategories: [...maintenanceCategories[key].subCategories, { label: 'New sub-category', score: 50 }] },
    }
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
    setPendingFocusSubKey(`${key}::${newIndex}`)
  }

  function updateSubCategoryLabel(key, idx, value) {
    setMaintenanceCategories(prev => ({
      ...prev,
      [key]: { ...prev[key], subCategories: prev[key].subCategories.map((s, i) => i === idx ? { ...s, label: value } : s) },
    }))
  }

  function updateSubCategoryScore(key, idx, value) {
    setMaintenanceCategories(prev => ({
      ...prev,
      [key]: { ...prev[key], subCategories: prev[key].subCategories.map((s, i) => i === idx ? { ...s, score: value } : s) },
    }))
  }

  function removeSubCategory(key, idx) {
    const updated = { ...maintenanceCategories, [key]: { ...maintenanceCategories[key], subCategories: maintenanceCategories[key].subCategories.filter((_, i) => i !== idx) } }
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
  }

  // Fixed thresholds for this section specifically (separate from the
  // adjustable Priority Engine Thresholds above, which govern real ticket
  // escalation) -- these are just the display labels shown on each
  // category/sub-category card while editing.
  function categoryTierForScore(score) {
    const n = Number(score)
    if (n >= 120) return { label: 'P1 Critical', color: '#dc2626' }
    if (n >= 70) return { label: 'P2 Urgent', color: '#d97706' }
    return { label: 'Routine', color: '#64748b' }
  }

  useEffect(() => {
    if (pendingFocusSubKey && subCategoryInputRefs.current[pendingFocusSubKey]) {
      subCategoryInputRefs.current[pendingFocusSubKey].focus()
      setPendingFocusSubKey(null)
    }
  }, [pendingFocusSubKey, maintenanceCategories])

  function persistComplianceTypes(updated) {
    saveSetting('compliance_check_types', updated)
  }

  function toggleCheckTypeEnabled(typeId) {
    const updated = complianceTypes.map(t => t.id === typeId ? { ...t, enabled: !t.enabled } : t)
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
  }

  function updateCheckTypeName(typeId, value) {
    setComplianceTypes(prev => prev.map(t => t.id === typeId ? { ...t, name: value } : t))
  }

  function handleCheckTypeNameBlur() {
    persistComplianceTypes(complianceTypes)
  }

  function updateCheckTypeCategory(typeId, category) {
    const updated = complianceTypes.map(t => t.id === typeId ? { ...t, category } : t)
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
  }

  function removeCheckType(typeId) {
    const type = complianceTypes.find(t => t.id === typeId)
    if (!window.confirm(`Remove "${type?.name}"? This can't be undone.`)) return
    const updated = complianceTypes.filter(t => t.id !== typeId)
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
  }

  function startAddType() {
    setAddingType(true)
    setNewTypeName('')
  }

  function cancelAddType() {
    setAddingType(false)
    setNewTypeName('')
  }

  function confirmAddType() {
    const name = newTypeName.trim()
    if (!name) return
    const newType = { id: `check-${Date.now()}`, name, enabled: true, category: CATEGORY_OPTIONS[0], items: [] }
    const updated = [...complianceTypes, newType]
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
    setAddingType(false)
    setNewTypeName('')
  }

  function addChecklistItem(typeId) {
    const newItemId = `item-${Date.now()}`
    const updated = complianceTypes.map(t => t.id === typeId
      ? { ...t, items: [...t.items, { id: newItemId, label: 'New checklist item', score: 60 }] }
      : t)
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
    setPendingFocusItemId(newItemId)
  }

  function updateItemLabel(typeId, itemId, value) {
    setComplianceTypes(prev => prev.map(t => t.id === typeId
      ? { ...t, items: t.items.map(i => i.id === itemId ? { ...i, label: value } : i) }
      : t))
  }

  function handleItemLabelBlur() {
    persistComplianceTypes(complianceTypes)
  }

  function updateItemScore(typeId, itemId, value) {
    const updated = complianceTypes.map(t => t.id === typeId
      ? { ...t, items: t.items.map(i => i.id === itemId ? { ...i, score: value } : i) }
      : t)
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
  }

  function removeChecklistItem(typeId, itemId) {
    const updated = complianceTypes.map(t => t.id === typeId
      ? { ...t, items: t.items.filter(i => i.id !== itemId) }
      : t)
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
  }

  function tierForScore(score) {
    const n = Number(score)
    if (n >= Number(p1Threshold)) return { label: 'P1 Critical', color: '#dc2626' }
    if (n >= Number(p2Threshold)) return { label: 'P2 Urgent', color: '#d97706' }
    return { label: 'Routine', color: '#64748b' }
  }

  useEffect(() => {
    if (pendingFocusItemId && itemInputRefs.current[pendingFocusItemId]) {
      itemInputRefs.current[pendingFocusItemId].focus()
      setPendingFocusItemId(null)
    }
  }, [pendingFocusItemId, complianceTypes])

  async function saveClockingRules() {
    setClockingSaving(true)
    setClockingSaved(false)
    await saveSetting('clock_overrun_hours', Number(clockOverrunHours))
    await saveSetting('done_window_hours', Number(doneWindowHours))
    await saveSetting('clock_distance_threshold_meters', Number(clockDistanceThresholdM))
    setClockingSaving(false)
    setClockingSaved(true)
    setTimeout(() => setClockingSaved(false), 2000)
  }

  async function addRosterContact() {
    const updated = [...roster, { id: Date.now(), name: '', role: '', phone: '' }]
    setRoster(updated)
    await saveSetting('on_call_roster', updated)
  }

  async function removeRosterContact(id) {
    const updated = roster.filter(c => c.id !== id)
    setRoster(updated)
    await saveSetting('on_call_roster', updated)
  }

  function updateRosterField(id, field, value) {
    setRoster(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  async function saveRoster() {
    setRosterSaving(true)
    setRosterSaved(false)
    await saveSetting('on_call_roster', roster)
    setRosterSaving(false)
    setRosterSaved(true)
    setTimeout(() => setRosterSaved(false), 2000)
  }

  async function saveDashboardMetrics() {
    setDashboardMetricsSaving(true)
    setDashboardMetricsSaved(false)
    await saveSetting('new_property_window_hours', Number(newPropertyWindowHours))
    setDashboardMetricsSaving(false)
    setDashboardMetricsSaved(true)
    setTimeout(() => setDashboardMetricsSaved(false), 2000)
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading settings...</p>
    </div>
  )

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Settings</h1>
          <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>Calibrate how the system scores, escalates, and tracks work across the whole team.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={expandAll} style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            Expand all
          </button>
          <button onClick={collapseAll} style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            Collapse all
          </button>
        </div>
      </div>

      {/* Section 1: Priority Engine Thresholds */}
      <SettingsSection
        title="Priority Engine Thresholds"
        subtitle="Controls when a ticket is treated as P1 Critical or P2 Urgent."
        open={!!openSections['priority-thresholds']}
        onToggle={() => toggleSection('priority-thresholds')}
      >
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>P1 Critical threshold</label>
            <input
              type="number"
              value={p1Threshold}
              onChange={(e) => setP1Threshold(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>Tickets scoring this or above trigger emergency escalation. Currently <strong style={{ color: '#dc2626' }}>{p1Threshold}</strong>.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>P2 Urgent threshold</label>
            <input
              type="number"
              value={p2Threshold}
              onChange={(e) => setP2Threshold(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>Tickets scoring this or above (but below P1) are flagged urgent. Currently <strong style={{ color: '#d97706' }}>{p2Threshold}</strong>.</p>
          </div>
        </div>

        <button onClick={saveThresholds} disabled={thresholdsSaving} style={{ ...saveBtnStyle, opacity: thresholdsSaving ? 0.6 : 1, cursor: thresholdsSaving ? 'not-allowed' : 'pointer' }}>
          {thresholdsSaving ? 'Saving...' : 'Save Thresholds'}
        </button>
        {thresholdsSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 2: Maintenance Categories */}
      <SettingsSection
        title="Maintenance Categories"
        subtitle="Manage the ticket categories builders and admins can select, their sub-categories, and the priority score each one carries."
        open={!!openSections['issue-scores']}
        onToggle={() => toggleSection('issue-scores')}
        headerExtra={
          <button
            onClick={(e) => { e.stopPropagation(); addCategory() }}
            style={{ padding: '8px 16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ＋ Add Category
          </button>
        }
      >
        {Object.keys(maintenanceCategories).length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No maintenance categories yet.</p>
        )}

        {Object.entries(maintenanceCategories).map(([key, category]) => {
          const weightTier = categoryTierForScore(category.weight)
          return (
            <div key={key} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '12px', background: category.enabled ? '#ffffff' : '#f8fafc' }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => toggleCategoryEnabled(key)}
                  title={category.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  style={{
                    width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: category.enabled ? '#0d9488' : '#cbd5e1', color: '#ffffff', fontSize: '16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  👁
                </button>
                <input
                  type="text"
                  value={categoryRenameDrafts[key] ?? key}
                  onChange={(e) => handleCategoryNameChange(key, e.target.value)}
                  onBlur={() => handleCategoryNameBlur(key)}
                  style={{ flex: '2 1 220px', height: '36px', padding: '0 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 700, color: '#0f172a', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <input
                    type="number"
                    min={0}
                    max={150}
                    value={category.weight}
                    onChange={(e) => handleCategoryWeightChange(key, e.target.value)}
                    onBlur={handleCategoryFieldBlur}
                    style={{ width: '80px', height: '36px', padding: '0 8px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' }}
                  />
                  <span style={{ fontSize: '10px', fontWeight: 700, color: weightTier.color, marginTop: '3px', whiteSpace: 'nowrap' }}>{weightTier.label}</span>
                </div>
                <button
                  onClick={() => removeCategory(key)}
                  style={{ padding: '8px 14px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >
                  ✕ Remove
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                {category.subCategories.length === 0 && (
                  <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No sub-categories yet.</p>
                )}
                {category.subCategories.map((sub, idx) => {
                  const subKey = `${key}::${idx}`
                  const tier = categoryTierForScore(sub.score)
                  return (
                    <div key={subKey} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ width: '18px', fontSize: '12px', color: '#94a3b8', flexShrink: 0, marginTop: '10px' }}>{idx + 1}.</span>
                      <input
                        ref={(el) => { subCategoryInputRefs.current[subKey] = el }}
                        type="text"
                        value={sub.label}
                        onChange={(e) => updateSubCategoryLabel(key, idx, e.target.value)}
                        onBlur={handleCategoryFieldBlur}
                        style={{ flex: 1, height: '36px', padding: '0 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <input
                          type="number"
                          min={0}
                          max={150}
                          value={sub.score}
                          onChange={(e) => updateSubCategoryScore(key, idx, e.target.value)}
                          onBlur={handleCategoryFieldBlur}
                          style={{ width: '70px', height: '36px', padding: '0 8px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' }}
                        />
                        <span style={{ fontSize: '10px', fontWeight: 700, color: tier.color, marginTop: '3px', whiteSpace: 'nowrap' }}>{tier.label}</span>
                      </div>
                      <button
                        onClick={() => removeSubCategory(key, idx)}
                        style={{ width: '32px', height: '36px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', flexShrink: 0 }}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={() => addSubCategory(key)}
                style={{ width: '100%', padding: '10px', border: '2px dashed #cbd5e1', background: 'none', color: '#64748b', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                ＋ Add sub-category
              </button>
            </div>
          )
        })}
      </SettingsSection>

      {/* Section 3: Compliance Check Types */}
      <SettingsSection
        title="Compliance Check Types"
        subtitle="Manage which safety checks builders can run, their category, and the score each item carries if it fails."
        open={!!openSections['compliance-types']}
        onToggle={() => toggleSection('compliance-types')}
        headerExtra={
          <button
            onClick={(e) => { e.stopPropagation(); startAddType() }}
            style={{ padding: '8px 16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            ＋ Add Check Type
          </button>
        }
      >
        {addingType && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', padding: '12px', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '10px' }}>
            <input
              type="text"
              autoFocus
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmAddType(); if (e.key === 'Escape') cancelAddType() }}
              placeholder="New check type name..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={confirmAddType} style={{ padding: '10px 16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Create</button>
            <button onClick={cancelAddType} style={{ padding: '10px 16px', background: '#fff', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          </div>
        )}

        {complianceTypes.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No compliance check types yet.</p>
        )}

        {complianceTypes.map(type => (
          <div key={type.id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '12px', background: type.enabled ? '#ffffff' : '#f8fafc' }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <button
                onClick={() => toggleCheckTypeEnabled(type.id)}
                title={type.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                style={{
                  width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: type.enabled ? '#0d9488' : '#cbd5e1', color: '#ffffff', fontSize: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                👁
              </button>
              <input
                type="text"
                value={type.name}
                onChange={(e) => updateCheckTypeName(type.id, e.target.value)}
                onBlur={handleCheckTypeNameBlur}
                style={{ flex: '2 1 220px', height: '36px', padding: '0 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 700, color: '#0f172a', boxSizing: 'border-box' }}
              />
              <select
                value={type.category}
                onChange={(e) => updateCheckTypeCategory(type.id, e.target.value)}
                style={{ flex: '1 1 170px', height: '36px', padding: '0 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box', background: '#fff' }}
              >
                {CATEGORY_OPTIONS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button
                onClick={() => removeCheckType(type.id)}
                style={{ padding: '8px 14px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
              >
                ✕ Remove
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
              {type.items.length === 0 && (
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No checklist items yet.</p>
              )}
              {type.items.map((item, idx) => {
                const tier = tierForScore(item.score)
                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <span style={{ width: '18px', fontSize: '12px', color: '#94a3b8', flexShrink: 0, marginTop: '10px' }}>{idx + 1}.</span>
                    <input
                      ref={(el) => { itemInputRefs.current[item.id] = el }}
                      type="text"
                      value={item.label}
                      onChange={(e) => updateItemLabel(type.id, item.id, e.target.value)}
                      onBlur={handleItemLabelBlur}
                      style={{ flex: 1, height: '36px', padding: '0 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <input
                        type="number"
                        min={0}
                        max={150}
                        value={item.score}
                        onChange={(e) => updateItemScore(type.id, item.id, e.target.value)}
                        style={{ width: '70px', height: '36px', padding: '0 8px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' }}
                      />
                      <span style={{ fontSize: '10px', fontWeight: 700, color: tier.color, marginTop: '3px', whiteSpace: 'nowrap' }}>{tier.label}</span>
                    </div>
                    <button
                      onClick={() => removeChecklistItem(type.id, item.id)}
                      style={{ width: '32px', height: '36px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', flexShrink: 0 }}
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => addChecklistItem(type.id)}
              style={{ width: '100%', padding: '10px', border: '2px dashed #cbd5e1', background: 'none', color: '#64748b', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
            >
              ＋ Add checklist item
            </button>
          </div>
        ))}
      </SettingsSection>

      {/* Section 4: Clocking Rules */}
      <SettingsSection
        title="Clocking Rules"
        subtitle="Controls the overrun warning on live jobs, how long finished jobs stay visible to builders, and the clock-in/out location check."
        open={!!openSections['clocking-rules']}
        onToggle={() => toggleSection('clocking-rules')}
      >
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Clock overrun warning (hours)</label>
            <input
              type="number"
              value={clockOverrunHours}
              onChange={(e) => setClockOverrunHours(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>How long before a clocked-in job shows the overrun warning.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Done window (hours)</label>
            <input
              type="number"
              value={doneWindowHours}
              onChange={(e) => setDoneWindowHours(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>How long completed jobs remain visible to builders.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Clock-in distance threshold (metres)</label>
            <input
              type="number"
              value={clockDistanceThresholdM}
              onChange={(e) => setClockDistanceThresholdM(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>Clock-in/out points further than this from the property are flagged on the Clocking page.</p>
          </div>
        </div>

        <button onClick={saveClockingRules} disabled={clockingSaving} style={{ ...saveBtnStyle, opacity: clockingSaving ? 0.6 : 1, cursor: clockingSaving ? 'not-allowed' : 'pointer' }}>
          {clockingSaving ? 'Saving...' : 'Save Clocking Rules'}
        </button>
        {clockingSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 5: On-Call Roster */}
      <SettingsSection
        title="On-Call Roster"
        subtitle="Contacts notified when a P1 Critical ticket is raised."
        open={!!openSections['on-call-roster']}
        onToggle={() => toggleSection('on-call-roster')}
      >
        {roster.length === 0 && (
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No on-call contacts added yet.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {roster.map(contact => (
            <div key={contact.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={contact.name}
                onChange={(e) => updateRosterField(contact.id, 'name', e.target.value)}
                placeholder="Name"
                style={{ ...inputStyle, flex: '2 1 140px' }}
              />
              <input
                type="text"
                value={contact.role}
                onChange={(e) => updateRosterField(contact.id, 'role', e.target.value)}
                placeholder="Role"
                style={{ ...inputStyle, flex: '2 1 140px' }}
              />
              <input
                type="text"
                value={contact.phone}
                onChange={(e) => updateRosterField(contact.id, 'phone', e.target.value)}
                placeholder="Phone"
                style={{ ...inputStyle, flex: '2 1 140px' }}
              />
              <button
                onClick={() => removeRosterContact(contact.id)}
                style={{ padding: '10px 14px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={addRosterContact}
            style={{ padding: '10px 20px', background: '#fff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
          >
            + Add new contact
          </button>
          <button onClick={saveRoster} disabled={rosterSaving} style={{ ...saveBtnStyle, opacity: rosterSaving ? 0.6 : 1, cursor: rosterSaving ? 'not-allowed' : 'pointer' }}>
            {rosterSaving ? 'Saving...' : 'Save Roster'}
          </button>
          {rosterSaved && <span style={savedTagStyle}>✓ Saved</span>}
        </div>
      </SettingsSection>

      {/* Section 6: Dashboard Metrics */}
      <SettingsSection
        title="Dashboard Metrics"
        subtitle="Controls how the admin dashboard's KPI tiles behave."
        open={!!openSections['dashboard-metrics']}
        onToggle={() => toggleSection('dashboard-metrics')}
      >
        <div style={{ marginBottom: '16px' }}>
          <label style={fieldLabelStyle}>New Properties alert window</label>
          <select
            value={newPropertyWindowHours}
            onChange={(e) => setNewPropertyWindowHours(e.target.value)}
            style={inputStyle}
          >
            <option value={24}>24 hours</option>
            <option value={48}>48 hours</option>
            <option value={168}>7 days</option>
            <option value={720}>30 days</option>
          </select>
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>Properties added within this window count toward the "New Properties" dashboard tile.</p>
        </div>

        <button onClick={saveDashboardMetrics} disabled={dashboardMetricsSaving} style={{ ...saveBtnStyle, opacity: dashboardMetricsSaving ? 0.6 : 1, cursor: dashboardMetricsSaving ? 'not-allowed' : 'pointer' }}>
          {dashboardMetricsSaving ? 'Saving...' : 'Save Dashboard Metrics'}
        </button>
        {dashboardMetricsSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

    </div>
  )
}
