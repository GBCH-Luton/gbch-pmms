import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { DEFAULT_COMPLIANCE_CHECK_TYPES } from '../../lib/compliance'
import { DEFAULT_MAINTENANCE_CATEGORIES, migrateLegacyArrayShape, sortedCategoryEntries } from '../../lib/maintenanceCategories'
import { DEFAULT_DIVISIONS } from '../../lib/divisions'
import { DEFAULT_TOWNS } from '../../lib/towns'
import ContractorProfileModal from './ContractorProfileModal'
import {
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalSubtitleStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, statusLabel,
} from './shared'

const CATEGORY_OPTIONS = ['Electricity', 'Plumbing', 'Doors/Locks', 'Other / Unlisted Trade']

const STUCK_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']
const STUCK_TIERS = ['P1 Critical', 'P2 Urgent', 'P3 Routine']
const DEFAULT_STUCK_THRESHOLDS = {
  'Pending':     { 'P1 Critical': { value: 2, unit: 'hours' }, 'P2 Urgent': { value: 8, unit: 'hours' }, 'P3 Routine': { value: 1, unit: 'days' } },
  'Assigned':    { 'P1 Critical': { value: 4, unit: 'hours' }, 'P2 Urgent': { value: 1, unit: 'days' },  'P3 Routine': { value: 3, unit: 'days' } },
  'In Progress': { 'P1 Critical': { value: 8, unit: 'hours' }, 'P2 Urgent': { value: 2, unit: 'days' },  'P3 Routine': { value: 5, unit: 'days' } },
  'On Hold':     { 'P1 Critical': { value: 1, unit: 'days' },  'P2 Urgent': { value: 3, unit: 'days' },  'P3 Routine': { value: 7, unit: 'days' } },
}

const cardStyle = { background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const cardHeadingStyle = { margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }
const cardSubtextStyle = { margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }
const fieldLabelStyle = { display: 'block', margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }
const inputStyle = { width: '100%', height: '40px', padding: '0 12px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }
const saveBtnStyle = { padding: '10px 20px', background: COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
const savedTagStyle = { marginLeft: '10px', fontSize: '12px', fontWeight: 700, color: COLORS.green600 }
const stickyAddBtnStyle = { padding: '8px 16px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }
const countChipStyle = { fontSize: '11px', fontWeight: 700, color: COLORS.slate500, background: COLORS.slate100, padding: '3px 10px', borderRadius: '20px', flexShrink: 0, whiteSpace: 'nowrap' }
const expandToggleBtnStyle = { width: '32px', height: '32px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, fontSize: '13px', fontWeight: 700, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }
const orderInputStyle = { width: '40px', height: '32px', padding: 0, borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontWeight: 700, color: COLORS.slate600, textAlign: 'center', boxSizing: 'border-box', flexShrink: 0 }
const removeBtnStyle = { padding: '8px 14px', background: COLORS.white, color: COLORS.red600, border: `1px solid ${COLORS.red200}`, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', flexShrink: 0, marginLeft: 'auto' }

const SECTION_IDS = ['priority-thresholds', 'issue-scores', 'contractors', 'compliance-types', 'clocking-rules', 'daily-attendance', 'stuck-ticket-alerts', 'compliance-alerts', 'dashboard-metrics', 'appearance']

function SettingsSection({ title, subtitle, headerExtra, open, onToggle, children }) {
  return (
    <div style={{ ...cardStyle, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          onClick={onToggle}
          style={{ display: 'flex', width: '100%', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <div>
            <p style={cardHeadingStyle}>{title}</p>
            <p style={{ ...cardSubtextStyle, marginBottom: open ? '16px' : 0 }}>{subtitle}</p>
          </div>
          <span style={{ fontSize: '13px', color: COLORS.slate400, fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {open ? '▲ Collapse' : '▼ Expand'}
          </span>
        </button>
        {open && children}
      </div>
      {/* This column stretches to match the height of the content column
          above (default flex align-items: stretch), which is what gives
          the inner sticky button room to actually stick while scrolling
          through a long, expanded card list -- position: sticky only has
          effect within its own parent's box height. */}
      {headerExtra && (
        <div style={{ flexShrink: 0, alignSelf: 'stretch', position: 'relative' }}>
          <div style={{ position: 'sticky', top: '16px', zIndex: 10 }}>{headerExtra}</div>
        </div>
      )}
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
  const [categoryOrderDrafts, setCategoryOrderDrafts] = useState({})
  const [pendingFocusSubKey, setPendingFocusSubKey] = useState(null)
  const subCategoryInputRefs = useRef({})
  const [expandedCategories, setExpandedCategories] = useState({})
  const [pendingFocusCategoryKey, setPendingFocusCategoryKey] = useState(null)
  const categoryNameInputRefs = useRef({})

  // Contractors -- a real table (not a pmms.settings JSONB row like
  // categories/check types above), since it needs its own primary key for
  // pmms.tickets.assigned_contractor_id to reference. Flat list, no
  // sub-items, so no expand/collapse machinery is needed here.
  const [contractors, setContractors] = useState([])
  const [pendingFocusContractorId, setPendingFocusContractorId] = useState(null)
  const contractorNameInputRefs = useRef({})
  const [contractorProfileId, setContractorProfileId] = useState(null)

  const [complianceTypes, setComplianceTypes] = useState(DEFAULT_COMPLIANCE_CHECK_TYPES)
  const [typeOrderDrafts, setTypeOrderDrafts] = useState({})
  const [addingType, setAddingType] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [pendingFocusItemId, setPendingFocusItemId] = useState(null)
  const itemInputRefs = useRef({})
  const [expandedTypes, setExpandedTypes] = useState({})

  const [pendingRemoval, setPendingRemoval] = useState(null) // { kind: 'category'|'type', key|id, label }

  const [divisions, setDivisions] = useState(DEFAULT_DIVISIONS)

  const [clockOverrunHours, setClockOverrunHours] = useState(8)
  const [doneWindowHours, setDoneWindowHours] = useState(24)
  const [clockDistanceThresholdM, setClockDistanceThresholdM] = useState(250)
  const [clockFlagLookbackDays, setClockFlagLookbackDays] = useState(30)
  const [longBreakAlertMinutes, setLongBreakAlertMinutes] = useState(45)
  const [longRunningJobAlertHours, setLongRunningJobAlertHours] = useState(6)
  const [idleAlertMinutes, setIdleAlertMinutes] = useState(30)
  const [clockingSaving, setClockingSaving] = useState(false)
  const [clockingSaved, setClockingSaved] = useState(false)

  const [dailyClockInDeadline, setDailyClockInDeadline] = useState('09:00')
  const [dailyClockOutReminderTime, setDailyClockOutReminderTime] = useState('17:00')
  const [overtimeThresholdHours, setOvertimeThresholdHours] = useState(8)
  const [staleShiftHours, setStaleShiftHours] = useState(16)
  const [autoClockOutGraceMinutes, setAutoClockOutGraceMinutes] = useState(120)
  const [dailyAttendanceSaving, setDailyAttendanceSaving] = useState(false)
  const [dailyAttendanceSaved, setDailyAttendanceSaved] = useState(false)

  const [stuckThresholds, setStuckThresholds] = useState(DEFAULT_STUCK_THRESHOLDS)
  const [stuckAlertsEnabled, setStuckAlertsEnabled] = useState(true)
  const [stuckAlertsSaving, setStuckAlertsSaving] = useState(false)
  const [stuckAlertsSaved, setStuckAlertsSaved] = useState(false)

  const [complianceAgingThresholdDays, setComplianceAgingThresholdDays] = useState(90)
  const [complianceAlertsEnabled, setComplianceAlertsEnabled] = useState(true)
  const [complianceAlertsSaving, setComplianceAlertsSaving] = useState(false)
  const [complianceAlertsSaved, setComplianceAlertsSaved] = useState(false)

  const [voidAgingThresholdDays, setVoidAgingThresholdDays] = useState(45)
  const [voidAlertsEnabled, setVoidAlertsEnabled] = useState(true)
  const [voidAlertsSaving, setVoidAlertsSaving] = useState(false)
  const [voidAlertsSaved, setVoidAlertsSaved] = useState(false)

  const [signOffThresholdHours, setSignOffThresholdHours] = useState(48)
  const [signOffThresholdSaving, setSignOffThresholdSaving] = useState(false)
  const [signOffThresholdSaved, setSignOffThresholdSaved] = useState(false)

  const [routineVisitFlagDays, setRoutineVisitFlagDays] = useState(12)
  const [routineVisitAlertsEnabled, setRoutineVisitAlertsEnabled] = useState(true)
  // These jobs are created by check-routine-visits-due (pg_cron, no
  // manager in the loop) -- the estimated-time field on Log a Ticket/
  // Reassign can't reach a ticket that's never opened in that UI, so this
  // is the equivalent for the one auto-routed path that exists today.
  const [routineVisitEstimatedMinutes, setRoutineVisitEstimatedMinutes] = useState(30)
  const [routineVisitSaving, setRoutineVisitSaving] = useState(false)
  const [routineVisitSaved, setRoutineVisitSaved] = useState(false)

  const [gardenServiceDaysSummer, setGardenServiceDaysSummer] = useState(90)
  const [gardenServiceDaysWinter, setGardenServiceDaysWinter] = useState(180)
  const [gardenAutoTicketEnabled, setGardenAutoTicketEnabled] = useState(true)
  const [gardenReviewSaving, setGardenReviewSaving] = useState(false)
  const [gardenReviewSaved, setGardenReviewSaved] = useState(false)

  const [routineVisitChecklist, setRoutineVisitChecklist] = useState([])
  const [newChecklistItem, setNewChecklistItem] = useState('')
  const [checklistError, setChecklistError] = useState('')
  const [checklistSaving, setChecklistSaving] = useState(false)
  // Suggestions offered on the builder's "Buying Materials" Leaving Site
  // page -- typing anything not on this list is still accepted as free
  // text there, this is just the type-ahead. { name, active } so a store
  // that's closed down can be turned off without losing the history of
  // past trips that named it.
  const [materialStores, setMaterialStores] = useState([])
  const [newMaterialStore, setNewMaterialStore] = useState('')
  const [materialStoreError, setMaterialStoreError] = useState('')
  const [materialStoreSaving, setMaterialStoreSaving] = useState(false)
  const [towns, setTowns] = useState(DEFAULT_TOWNS)
  const [newTownName, setNewTownName] = useState('')
  const [townError, setTownError] = useState('')
  const [townSaving, setTownSaving] = useState(false)


  const [newPropertyWindowHours, setNewPropertyWindowHours] = useState(48)
  const [totalTicketsPeriod, setTotalTicketsPeriod] = useState('all_time')
  const [dashboardCardHeightPx, setDashboardCardHeightPx] = useState(250)
  const [dashboardMetricsSaving, setDashboardMetricsSaving] = useState(false)
  const [dashboardMetricsSaved, setDashboardMetricsSaved] = useState(false)

  // Default 9 -- a little taller than KpiTiles' own hardcoded fallback
  // (7px, see shared.jsx) so tiles read as tiles rather than flat
  // buttons out of the box, per the user's own complaint. This is the
  // knob for that going forward instead of a code change each time.
  const [kpiTilePaddingPx, setKpiTilePaddingPx] = useState(9)
  const [appearanceSaving, setAppearanceSaving] = useState(false)
  const [appearanceSaved, setAppearanceSaved] = useState(false)

  // Left blank ('') rather than defaulted -- a real query with unpriced
  // usage must show as "cost unknown" (see AdminReports.jsx's AI Usage
  // table), not silently report $0. Rates are per Anthropic's published
  // per-million-token pricing for whichever model ai-ask is using
  // (currently Claude Haiku 4.5) -- check console.anthropic.com/settings/pricing
  // for current figures when setting these.
  const [aiInputCostPerMillion, setAiInputCostPerMillion] = useState('')
  const [aiOutputCostPerMillion, setAiOutputCostPerMillion] = useState('')
  const [aiUsageLogPageSize, setAiUsageLogPageSize] = useState(5)
  const [aiPricingSaving, setAiPricingSaving] = useState(false)
  const [aiPricingSaved, setAiPricingSaved] = useState(false)

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
      if (map.stuck_ticket_thresholds) setStuckThresholds(map.stuck_ticket_thresholds)
      if (map.stuck_alerts_enabled != null) setStuckAlertsEnabled(map.stuck_alerts_enabled)
      if (map.compliance_aging_threshold_days != null) setComplianceAgingThresholdDays(map.compliance_aging_threshold_days)
      if (map.compliance_alerts_enabled != null) setComplianceAlertsEnabled(map.compliance_alerts_enabled)
      if (map.void_aging_threshold_days != null) setVoidAgingThresholdDays(map.void_aging_threshold_days)
      if (map.void_alerts_enabled != null) setVoidAlertsEnabled(map.void_alerts_enabled)
      if (map.sign_off_wait_threshold_hours != null) setSignOffThresholdHours(Number(map.sign_off_wait_threshold_hours))
      if (map.ai_cost_per_million_input_tokens != null) setAiInputCostPerMillion(map.ai_cost_per_million_input_tokens)
      if (map.ai_cost_per_million_output_tokens != null) setAiOutputCostPerMillion(map.ai_cost_per_million_output_tokens)
      if (map.ai_usage_log_page_size != null) setAiUsageLogPageSize(Number(map.ai_usage_log_page_size))
      if (map.routine_visit_flag_days != null) setRoutineVisitFlagDays(map.routine_visit_flag_days)
      if (map.routine_visit_alerts_enabled != null) setRoutineVisitAlertsEnabled(map.routine_visit_alerts_enabled)
      if (map.routine_visit_estimated_minutes != null) setRoutineVisitEstimatedMinutes(map.routine_visit_estimated_minutes)
      if (map.garden_service_days_summer != null) setGardenServiceDaysSummer(map.garden_service_days_summer)
      if (map.garden_service_days_winter != null) setGardenServiceDaysWinter(map.garden_service_days_winter)
      if (map.garden_auto_ticket_enabled != null) setGardenAutoTicketEnabled(map.garden_auto_ticket_enabled)
      if (Array.isArray(map.routine_visit_checklist)) setRoutineVisitChecklist(map.routine_visit_checklist)
      if (Array.isArray(map.material_stores)) setMaterialStores(map.material_stores)
      if (Array.isArray(map.towns) && map.towns.length > 0) setTowns(map.towns)
      if (map.clock_overrun_hours != null) setClockOverrunHours(map.clock_overrun_hours)
      if (map.done_window_hours != null) setDoneWindowHours(map.done_window_hours)
      if (map.clock_distance_threshold_meters != null) setClockDistanceThresholdM(map.clock_distance_threshold_meters)
      if (map.clock_flag_lookback_days != null) setClockFlagLookbackDays(map.clock_flag_lookback_days)
      if (map.long_break_alert_minutes != null) setLongBreakAlertMinutes(Number(map.long_break_alert_minutes))
      if (map.long_running_job_alert_hours != null) setLongRunningJobAlertHours(Number(map.long_running_job_alert_hours))
      if (map.idle_alert_minutes != null) setIdleAlertMinutes(Number(map.idle_alert_minutes))
      if (map.daily_clock_in_deadline != null) setDailyClockInDeadline(map.daily_clock_in_deadline)
      if (map.daily_clock_out_reminder_time != null) setDailyClockOutReminderTime(map.daily_clock_out_reminder_time)
      if (map.daily_overtime_threshold_hours != null) setOvertimeThresholdHours(Number(map.daily_overtime_threshold_hours))
      if (map.stale_shift_hours != null) setStaleShiftHours(Number(map.stale_shift_hours))
      if (map.auto_clock_out_grace_minutes != null) setAutoClockOutGraceMinutes(Number(map.auto_clock_out_grace_minutes))
      if (map.new_property_window_hours != null) setNewPropertyWindowHours(map.new_property_window_hours)
      if (map.dashboard_total_tickets_period != null) setTotalTicketsPeriod(map.dashboard_total_tickets_period)
      if (map.dashboard_top_card_height_px != null) setDashboardCardHeightPx(Number(map.dashboard_top_card_height_px))
      if (map.kpi_tile_padding_px != null) setKpiTilePaddingPx(Number(map.kpi_tile_padding_px))
      if (Array.isArray(map.divisions) && map.divisions.length > 0) setDivisions(map.divisions)
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

  // Which division this category belongs to -- read by pmms.category_division()
  // in RLS to decide whether a division-scoped manager can see/reassign a
  // ticket in this category. Defaults to 'Maintenance' for any category
  // that hasn't been explicitly tagged.
  function handleCategoryDivisionChange(key, division) {
    const updated = { ...maintenanceCategories, [key]: { ...maintenanceCategories[key], division } }
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

  // Fallback estimated time (minutes) used when a sub-category doesn't carry
  // its own, or an unlisted issue is picked -- pre-fills the "Estimated time"
  // field when a manager raises a ticket, same as weight/score do today.
  function handleCategoryDefaultMinutesChange(key, value) {
    setMaintenanceCategories(prev => ({ ...prev, [key]: { ...prev[key], defaultMinutes: value } }))
  }

  function handleCategoryFieldBlur() {
    persistMaintenanceCategories(maintenanceCategories)
  }

  function requestRemoveCategory(key) {
    setPendingRemoval({ kind: 'category', key, label: key })
  }

  function addCategory() {
    let name = 'New Category'
    let n = 2
    while (maintenanceCategories[name]) { name = `New Category ${n}`; n += 1 }
    const updated = { ...maintenanceCategories, [name]: { enabled: true, weight: 50, defaultMinutes: 30, subCategories: [], order: Object.keys(maintenanceCategories).length } }
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
    setExpandedCategories(prev => ({ ...prev, [name]: true }))
    setPendingFocusCategoryKey(name)
  }

  function toggleCategoryExpanded(key) {
    setExpandedCategories(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function handleCategoryOrderInputChange(key, value) {
    setCategoryOrderDrafts(prev => ({ ...prev, [key]: value }))
  }

  function commitCategoryOrder(key) {
    const draft = categoryOrderDrafts[key]
    setCategoryOrderDrafts(prev => { const next = { ...prev }; delete next[key]; return next })
    if (draft == null || draft === '') return

    const entries = sortedCategoryEntries(maintenanceCategories)
    const keys = entries.map(([k]) => k)
    const total = keys.length
    let newPos = parseInt(draft, 10)
    if (Number.isNaN(newPos)) return
    newPos = Math.max(1, Math.min(total, newPos))

    const fromIdx = keys.indexOf(key)
    const toIdx = newPos - 1
    if (fromIdx === toIdx) return

    const reordered = [...keys]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    // Re-number every category's order field to match the new sequence --
    // this is what actually persists correctly (see sortedCategoryEntries).
    const updated = {}
    reordered.forEach((k, i) => { updated[k] = { ...maintenanceCategories[k], order: i } })
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
  }

  function addSubCategory(key) {
    const newIndex = maintenanceCategories[key].subCategories.length
    const updated = {
      ...maintenanceCategories,
      [key]: { ...maintenanceCategories[key], subCategories: [...maintenanceCategories[key].subCategories, { label: 'New sub-category', score: 50, minutes: 30 }] },
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

  function updateSubCategoryMinutes(key, idx, value) {
    setMaintenanceCategories(prev => ({
      ...prev,
      [key]: { ...prev[key], subCategories: prev[key].subCategories.map((s, i) => i === idx ? { ...s, minutes: value } : s) },
    }))
  }

  function removeSubCategory(key, idx) {
    const updated = { ...maintenanceCategories, [key]: { ...maintenanceCategories[key], subCategories: maintenanceCategories[key].subCategories.filter((_, i) => i !== idx) } }
    setMaintenanceCategories(updated)
    persistMaintenanceCategories(updated)
  }

  function categoryTierForScore(score) {
    const n = Number(score)
    if (n >= Number(p1Threshold)) return { label: 'P1 Critical', color: COLORS.red600 }
    if (n >= Number(p2Threshold)) return { label: 'P2 Urgent', color: COLORS.amber600 }
    return { label: 'P3 Routine', color: COLORS.slate500 }
  }

  useEffect(() => {
    if (pendingFocusSubKey && subCategoryInputRefs.current[pendingFocusSubKey]) {
      subCategoryInputRefs.current[pendingFocusSubKey].focus()
      setPendingFocusSubKey(null)
    }
  }, [pendingFocusSubKey, maintenanceCategories])

  useEffect(() => {
    if (pendingFocusCategoryKey && categoryNameInputRefs.current[pendingFocusCategoryKey]) {
      categoryNameInputRefs.current[pendingFocusCategoryKey].focus()
      setPendingFocusCategoryKey(null)
    }
  }, [pendingFocusCategoryKey, maintenanceCategories])

  useEffect(() => {
    fetchContractors()
  }, [])

  async function fetchContractors() {
    const { data } = await supabase.schema('pmms').from('contractors').select('*').order('name')
    setContractors(data || [])
  }

  useEffect(() => {
    if (pendingFocusContractorId && contractorNameInputRefs.current[pendingFocusContractorId]) {
      contractorNameInputRefs.current[pendingFocusContractorId].focus()
      setPendingFocusContractorId(null)
    }
  }, [pendingFocusContractorId, contractors])

  function updateContractorField(id, field, value) {
    setContractors(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  async function persistContractor(id) {
    const c = contractors.find(x => x.id === id)
    if (!c) return
    await supabase.schema('pmms').from('contractors').update({
      name: c.name, company_name: c.company_name, contact_phone: c.contact_phone, contact_email: c.contact_email, notes: c.notes,
    }).eq('id', id)
  }

  async function toggleContractorActive(id) {
    const c = contractors.find(x => x.id === id)
    if (!c) return
    setContractors(prev => prev.map(x => x.id === id ? { ...x, active: !x.active } : x))
    await supabase.schema('pmms').from('contractors').update({ active: !c.active }).eq('id', id)
  }

  async function addContractor() {
    const { data, error } = await supabase.schema('pmms').from('contractors').insert({ name: 'New Contractor', active: true }).select().single()
    if (!error && data) {
      setContractors(prev => [...prev, data])
      setPendingFocusContractorId(data.id)
    }
  }

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

  function requestRemoveType(typeId) {
    const type = complianceTypes.find(t => t.id === typeId)
    setPendingRemoval({ kind: 'type', id: typeId, label: type?.name })
  }

  function confirmPendingRemoval() {
    if (!pendingRemoval) return
    if (pendingRemoval.kind === 'category') {
      const updated = { ...maintenanceCategories }
      delete updated[pendingRemoval.key]
      setMaintenanceCategories(updated)
      persistMaintenanceCategories(updated)
    } else if (pendingRemoval.kind === 'type') {
      const updated = complianceTypes.filter(t => t.id !== pendingRemoval.id)
      setComplianceTypes(updated)
      persistComplianceTypes(updated)
    }
    setPendingRemoval(null)
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
    setExpandedTypes(prev => ({ ...prev, [newType.id]: true }))
    setAddingType(false)
    setNewTypeName('')
  }

  function toggleTypeExpanded(id) {
    setExpandedTypes(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function handleTypeOrderInputChange(id, value) {
    setTypeOrderDrafts(prev => ({ ...prev, [id]: value }))
  }

  function commitTypeOrder(id) {
    const draft = typeOrderDrafts[id]
    setTypeOrderDrafts(prev => { const next = { ...prev }; delete next[id]; return next })
    if (draft == null || draft === '') return

    const total = complianceTypes.length
    let newPos = parseInt(draft, 10)
    if (Number.isNaN(newPos)) return
    newPos = Math.max(1, Math.min(total, newPos))

    const fromIdx = complianceTypes.findIndex(t => t.id === id)
    const toIdx = newPos - 1
    if (fromIdx === toIdx) return

    const updated = [...complianceTypes]
    const [moved] = updated.splice(fromIdx, 1)
    updated.splice(toIdx, 0, moved)
    setComplianceTypes(updated)
    persistComplianceTypes(updated)
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
    if (n >= Number(p1Threshold)) return { label: 'P1 Critical', color: COLORS.red600 }
    if (n >= Number(p2Threshold)) return { label: 'P2 Urgent', color: COLORS.amber600 }
    return { label: 'P3 Routine', color: COLORS.slate500 }
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
    await saveSetting('clock_flag_lookback_days', Number(clockFlagLookbackDays))
    await saveSetting('long_break_alert_minutes', Number(longBreakAlertMinutes))
    await saveSetting('long_running_job_alert_hours', Number(longRunningJobAlertHours))
    await saveSetting('idle_alert_minutes', Number(idleAlertMinutes))
    setClockingSaving(false)
    setClockingSaved(true)
    setTimeout(() => setClockingSaved(false), 2000)
  }

  async function saveDailyAttendanceSettings() {
    setDailyAttendanceSaving(true)
    setDailyAttendanceSaved(false)
    await saveSetting('daily_clock_in_deadline', dailyClockInDeadline)
    await saveSetting('daily_clock_out_reminder_time', dailyClockOutReminderTime)
    await saveSetting('daily_overtime_threshold_hours', Number(overtimeThresholdHours))
    await saveSetting('stale_shift_hours', Number(staleShiftHours))
    await saveSetting('auto_clock_out_grace_minutes', Number(autoClockOutGraceMinutes))
    setDailyAttendanceSaving(false)
    setDailyAttendanceSaved(true)
    setTimeout(() => setDailyAttendanceSaved(false), 2000)
  }

  function updateStuckThresholdCell(status, tier, field, value) {
    setStuckThresholds(prev => ({
      ...prev,
      [status]: { ...prev[status], [tier]: { ...prev[status]?.[tier], [field]: value } },
    }))
  }

  async function saveStuckTicketAlerts() {
    setStuckAlertsSaving(true)
    setStuckAlertsSaved(false)
    await saveSetting('stuck_ticket_thresholds', stuckThresholds)
    await saveSetting('stuck_alerts_enabled', stuckAlertsEnabled)
    setStuckAlertsSaving(false)
    setStuckAlertsSaved(true)
    setTimeout(() => setStuckAlertsSaved(false), 2000)
  }

  async function saveComplianceAlerts() {
    setComplianceAlertsSaving(true)
    setComplianceAlertsSaved(false)
    await saveSetting('compliance_aging_threshold_days', Number(complianceAgingThresholdDays))
    await saveSetting('compliance_alerts_enabled', complianceAlertsEnabled)
    setComplianceAlertsSaving(false)
    setComplianceAlertsSaved(true)
    setTimeout(() => setComplianceAlertsSaved(false), 2000)
  }

  async function saveVoidAlerts() {
    setVoidAlertsSaving(true)
    setVoidAlertsSaved(false)
    await saveSetting('void_aging_threshold_days', Number(voidAgingThresholdDays))
    await saveSetting('void_alerts_enabled', voidAlertsEnabled)
    setVoidAlertsSaving(false)
    setVoidAlertsSaved(true)
    setTimeout(() => setVoidAlertsSaved(false), 2000)
  }

  async function saveSignOffThreshold() {
    setSignOffThresholdSaving(true)
    setSignOffThresholdSaved(false)
    await saveSetting('sign_off_wait_threshold_hours', Number(signOffThresholdHours))
    setSignOffThresholdSaving(false)
    setSignOffThresholdSaved(true)
    setTimeout(() => setSignOffThresholdSaved(false), 2000)
  }

  async function saveRoutineVisitAlerts() {
    setRoutineVisitSaving(true)
    setRoutineVisitSaved(false)
    await saveSetting('routine_visit_flag_days', Number(routineVisitFlagDays))
    await saveSetting('routine_visit_alerts_enabled', routineVisitAlertsEnabled)
    await saveSetting('routine_visit_estimated_minutes', Number(routineVisitEstimatedMinutes))
    setRoutineVisitSaving(false)
    setRoutineVisitSaved(true)
    setTimeout(() => setRoutineVisitSaved(false), 2000)
  }

  async function saveGardenReviewSettings() {
    setGardenReviewSaving(true)
    setGardenReviewSaved(false)
    await saveSetting('garden_service_days_summer', Number(gardenServiceDaysSummer))
    await saveSetting('garden_service_days_winter', Number(gardenServiceDaysWinter))
    await saveSetting('garden_auto_ticket_enabled', gardenAutoTicketEnabled)
    setGardenReviewSaving(false)
    setGardenReviewSaved(true)
    setTimeout(() => setGardenReviewSaved(false), 2000)
  }

  async function handleAddChecklistItem() {
    setChecklistError('')
    const label = newChecklistItem.trim()
    if (!label) { setChecklistError('Enter a checklist item.'); return }
    if (routineVisitChecklist.some(i => i.toLowerCase() === label.toLowerCase())) { setChecklistError('That item already exists.'); return }

    setChecklistSaving(true)
    const next = [...routineVisitChecklist, label]
    await saveSetting('routine_visit_checklist', next)
    setRoutineVisitChecklist(next)
    setChecklistSaving(false)
    setNewChecklistItem('')
  }

  async function handleDeleteChecklistItem(label) {
    const next = routineVisitChecklist.filter(i => i !== label)
    await saveSetting('routine_visit_checklist', next)
    setRoutineVisitChecklist(next)
  }

  async function handleAddMaterialStore() {
    setMaterialStoreError('')
    const name = newMaterialStore.trim()
    if (!name) { setMaterialStoreError('Enter a store name.'); return }
    if (materialStores.some(s => s.name.toLowerCase() === name.toLowerCase())) { setMaterialStoreError('That store already exists.'); return }

    setMaterialStoreSaving(true)
    const next = [...materialStores, { name, active: true }]
    await saveSetting('material_stores', next)
    setMaterialStores(next)
    setMaterialStoreSaving(false)
    setNewMaterialStore('')
  }

  async function handleToggleMaterialStoreActive(name) {
    const next = materialStores.map(s => s.name === name ? { ...s, active: !s.active } : s)
    await saveSetting('material_stores', next)
    setMaterialStores(next)
  }

  async function handleDeleteMaterialStore(name) {
    const next = materialStores.filter(s => s.name !== name)
    await saveSetting('material_stores', next)
    setMaterialStores(next)
  }

  async function handleAddTown() {
    setTownError('')
    const name = newTownName.trim()
    if (!name) { setTownError('Enter a town/city name.'); return }
    if (towns.some(t => t.toLowerCase() === name.toLowerCase())) { setTownError('That town already exists.'); return }

    setTownSaving(true)
    const next = [...towns, name]
    await saveSetting('towns', next)
    setTowns(next)
    setTownSaving(false)
    setNewTownName('')
  }

  async function handleDeleteTown(name) {
    const next = towns.filter(t => t !== name)
    await saveSetting('towns', next)
    setTowns(next)
  }

  async function saveDashboardMetrics() {
    setDashboardMetricsSaving(true)
    setDashboardMetricsSaved(false)
    await saveSetting('new_property_window_hours', Number(newPropertyWindowHours))
    await saveSetting('dashboard_total_tickets_period', totalTicketsPeriod)
    await saveSetting('dashboard_top_card_height_px', Number(dashboardCardHeightPx))
    setDashboardMetricsSaving(false)
    setDashboardMetricsSaved(true)
    setTimeout(() => setDashboardMetricsSaved(false), 2000)
  }

  async function saveAppearance() {
    setAppearanceSaving(true)
    setAppearanceSaved(false)
    await saveSetting('kpi_tile_padding_px', Number(kpiTilePaddingPx))
    setAppearanceSaving(false)
    setAppearanceSaved(true)
    setTimeout(() => setAppearanceSaved(false), 2000)
  }

  async function saveAiPricing() {
    setAiPricingSaving(true)
    setAiPricingSaved(false)
    await saveSetting('ai_cost_per_million_input_tokens', aiInputCostPerMillion === '' ? null : Number(aiInputCostPerMillion))
    await saveSetting('ai_cost_per_million_output_tokens', aiOutputCostPerMillion === '' ? null : Number(aiOutputCostPerMillion))
    await saveSetting('ai_usage_log_page_size', Number(aiUsageLogPageSize))
    setAiPricingSaving(false)
    setAiPricingSaved(true)
    setTimeout(() => setAiPricingSaved(false), 2000)
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading settings...</p>
    </div>
  )

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Settings</h1>
          <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: COLORS.slate500 }}>Calibrate how the system scores, escalates, and tracks work across the whole team.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button onClick={expandAll} style={{ padding: '8px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
            Expand all
          </button>
          <button onClick={collapseAll} style={{ padding: '8px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
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
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Tickets scoring this or above trigger emergency escalation. Currently <strong style={{ color: COLORS.red600 }}>{p1Threshold}</strong>.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>P2 Urgent threshold</label>
            <input
              type="number"
              value={p2Threshold}
              onChange={(e) => setP2Threshold(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Tickets scoring this or above (but below P1) are flagged urgent. Currently <strong style={{ color: COLORS.amber600 }}>{p2Threshold}</strong>.</p>
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
        subtitle="Manage the ticket categories builders and admins can select, their sub-categories, the priority score each one carries, and the default estimated job time each one carries."
        open={!!openSections['issue-scores']}
        onToggle={() => toggleSection('issue-scores')}
        headerExtra={
          <button onClick={(e) => { e.stopPropagation(); addCategory() }} style={stickyAddBtnStyle}>
            ＋ Add Category
          </button>
        }
      >
        {Object.keys(maintenanceCategories).length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No maintenance categories yet.</p>
        )}

        {sortedCategoryEntries(maintenanceCategories).map(([key, category], idx) => {
          const weightTier = categoryTierForScore(category.weight)
          const isExpanded = !!expandedCategories[key]
          const orderValue = categoryOrderDrafts[key] ?? String(idx + 1)
          const orderInput = (
            <input
              type="number"
              min={1}
              max={sortedCategoryEntries(maintenanceCategories).length}
              value={orderValue}
              title="Position — type a number to move this category"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => handleCategoryOrderInputChange(key, e.target.value)}
              onBlur={() => commitCategoryOrder(key)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
              style={orderInputStyle}
            />
          )
          return (
            <div
              key={key}
              style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '16px', marginBottom: '12px', background: category.enabled ? COLORS.white : COLORS.slate50 }}
            >

              {isExpanded ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => toggleCategoryExpanded(key)}
                    title="Collapse"
                    style={expandToggleBtnStyle}
                  >
                    ▲
                  </button>
                  {orderInput}
                  <button
                    onClick={() => toggleCategoryEnabled(key)}
                    title={category.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                    style={{
                      width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: category.enabled ? COLORS.teal600 : COLORS.slate300, color: COLORS.white, fontSize: '16px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    👁
                  </button>
                  <input
                    ref={(el) => { categoryNameInputRefs.current[key] = el }}
                    type="text"
                    value={categoryRenameDrafts[key] ?? key}
                    onChange={(e) => handleCategoryNameChange(key, e.target.value)}
                    onBlur={() => handleCategoryNameBlur(key)}
                    style={{ flex: '2 1 220px', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontWeight: 700, color: COLORS.slate900, boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <input
                      type="number"
                      min={0}
                      max={150}
                      value={category.weight}
                      onChange={(e) => handleCategoryWeightChange(key, e.target.value)}
                      onBlur={handleCategoryFieldBlur}
                      style={{ width: '80px', height: '36px', padding: '0 8px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' }}
                    />
                    <span style={{ fontSize: '10px', fontWeight: 700, color: weightTier.color, marginTop: '3px', whiteSpace: 'nowrap' }}>{weightTier.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, background: COLORS.teal50, border: `1px solid ${COLORS.teal100}`, borderRadius: '8px', padding: '0 8px', height: '36px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.teal700, whiteSpace: 'nowrap' }}>Fallback time</span>
                    <input
                      type="number"
                      min={0}
                      step={5}
                      value={category.defaultMinutes ?? ''}
                      title="Used when a sub-category doesn't have its own time, or an unlisted issue is picked"
                      onChange={(e) => handleCategoryDefaultMinutesChange(key, e.target.value)}
                      onBlur={handleCategoryFieldBlur}
                      style={{ width: '54px', height: '28px', padding: '0 6px', borderRadius: '6px', border: `1px solid ${COLORS.slate200}`, fontSize: '12px', textAlign: 'center', boxSizing: 'border-box' }}
                    />
                    <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.teal700 }}>min</span>
                  </div>
                  <select
                    value={category.division || DEFAULT_DIVISIONS[0]}
                    onChange={(e) => handleCategoryDivisionChange(key, e.target.value)}
                    title="Which division this category belongs to -- scopes what a division-tagged manager can see/reassign"
                    style={{ height: '36px', padding: '0 8px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '12px', fontWeight: 700, color: COLORS.slate600, background: COLORS.white, flexShrink: 0, cursor: 'pointer' }}
                  >
                    {divisions.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <button
                    onClick={() => requestRemoveCategory(key)}
                    style={removeBtnStyle}
                  >
                    ✕ Remove
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => toggleCategoryExpanded(key)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flexWrap: 'wrap' }}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleCategoryExpanded(key) }}
                    title="Expand"
                    style={expandToggleBtnStyle}
                  >
                    ▼
                  </button>
                  {orderInput}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleCategoryEnabled(key) }}
                    title={category.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                    style={{
                      width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: category.enabled ? COLORS.teal600 : COLORS.slate300, color: COLORS.white, fontSize: '16px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    👁
                  </button>
                  <span style={{ flex: '2 1 220px', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{key}</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: weightTier.color, flexShrink: 0 }}>{category.weight} pts · {weightTier.label}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.teal700, background: COLORS.teal50, padding: '3px 10px', borderRadius: '20px', flexShrink: 0, whiteSpace: 'nowrap' }}>{category.defaultMinutes ?? '—'}m default</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.blue900, background: COLORS.blue100, padding: '3px 10px', borderRadius: '20px', flexShrink: 0, whiteSpace: 'nowrap' }}>{category.division || DEFAULT_DIVISIONS[0]}</span>
                  <span style={countChipStyle}>{category.subCategories.length} item{category.subCategories.length === 1 ? '' : 's'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); requestRemoveCategory(key) }}
                    style={removeBtnStyle}
                  >
                    ✕ Remove
                  </button>
                </div>
              )}

              {isExpanded && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                    {category.subCategories.length === 0 && (
                      <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate400, fontStyle: 'italic' }}>No sub-categories yet.</p>
                    )}
                    {category.subCategories.map((sub, idx) => {
                      const subKey = `${key}::${idx}`
                      const tier = categoryTierForScore(sub.score)
                      return (
                        <div key={subKey} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ width: '18px', fontSize: '12px', color: COLORS.slate400, flexShrink: 0, marginTop: '10px' }}>{idx + 1}.</span>
                          <input
                            ref={(el) => { subCategoryInputRefs.current[subKey] = el }}
                            type="text"
                            value={sub.label}
                            onChange={(e) => updateSubCategoryLabel(key, idx, e.target.value)}
                            onBlur={handleCategoryFieldBlur}
                            style={{ flex: 1, height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                            <input
                              type="number"
                              min={0}
                              max={150}
                              value={sub.score}
                              onChange={(e) => updateSubCategoryScore(key, idx, e.target.value)}
                              onBlur={handleCategoryFieldBlur}
                              style={{ width: '70px', height: '36px', padding: '0 8px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' }}
                            />
                            <span style={{ fontSize: '10px', fontWeight: 700, color: tier.color, marginTop: '3px', whiteSpace: 'nowrap' }}>{tier.label}</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                            <input
                              type="number"
                              min={0}
                              step={5}
                              value={sub.minutes ?? ''}
                              onChange={(e) => updateSubCategoryMinutes(key, idx, e.target.value)}
                              onBlur={handleCategoryFieldBlur}
                              style={{ width: '58px', height: '36px', padding: '0 8px', borderRadius: '8px', border: `1px solid ${COLORS.teal300}`, background: COLORS.teal50, color: COLORS.teal700, fontWeight: 700, fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' }}
                            />
                            <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.teal700, marginTop: '3px', whiteSpace: 'nowrap' }}>Est. min</span>
                          </div>
                          <button
                            onClick={() => removeSubCategory(key, idx)}
                            style={{ width: '32px', height: '36px', background: COLORS.white, color: COLORS.red600, border: `1px solid ${COLORS.red200}`, borderRadius: '8px', fontSize: '13px', cursor: 'pointer', flexShrink: 0 }}
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => addSubCategory(key)}
                    style={{ width: '100%', padding: '10px', border: `2px dashed ${COLORS.slate300}`, background: 'none', color: COLORS.slate500, borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    ＋ Add sub-category
                  </button>
                </>
              )}
            </div>
          )
        })}
      </SettingsSection>

      {/* Section: Contractors -- external companies/individuals jobs get
          sent to instead of an internal builder. Admin-only, same trust
          boundary as staff records today. Flat list, no specialty tagging
          for v1 -- any active contractor is assignable to any job. */}
      <SettingsSection
        title="Contractors"
        subtitle="Directory of external contractors jobs can be sent to instead of an internal builder -- admin-managed, used by Reassign, raise-ticket, and the Pipeline filter."
        open={!!openSections['contractors']}
        onToggle={() => toggleSection('contractors')}
        headerExtra={
          <button onClick={(e) => { e.stopPropagation(); addContractor() }} style={stickyAddBtnStyle}>
            ＋ Add Contractor
          </button>
        }
      >
        {contractors.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No contractors yet.</p>
        )}

        {contractors.map((c) => (
          <div
            key={c.id}
            style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '16px', marginBottom: '12px', background: c.active ? COLORS.white : COLORS.slate50 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <button
                onClick={() => toggleContractorActive(c.id)}
                title={c.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                style={{
                  width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: c.active ? COLORS.teal600 : COLORS.slate300, color: COLORS.white, fontSize: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                👁
              </button>
              <input
                ref={(el) => { contractorNameInputRefs.current[c.id] = el }}
                type="text"
                value={c.name}
                placeholder="Name"
                onChange={(e) => updateContractorField(c.id, 'name', e.target.value)}
                onBlur={() => persistContractor(c.id)}
                style={{ flex: '2 1 180px', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontWeight: 700, color: COLORS.slate900, boxSizing: 'border-box' }}
              />
              <input
                type="text"
                value={c.company_name || ''}
                placeholder="Company"
                onChange={(e) => updateContractorField(c.id, 'company_name', e.target.value)}
                onBlur={() => persistContractor(c.id)}
                style={{ flex: '2 1 160px', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
              />
              <input
                type="tel"
                value={c.contact_phone || ''}
                placeholder="Phone"
                onChange={(e) => updateContractorField(c.id, 'contact_phone', e.target.value)}
                onBlur={() => persistContractor(c.id)}
                style={{ flex: '1 1 130px', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
              />
              <input
                type="email"
                value={c.contact_email || ''}
                placeholder="Email (optional)"
                onChange={(e) => updateContractorField(c.id, 'contact_email', e.target.value)}
                onBlur={() => persistContractor(c.id)}
                style={{ flex: '2 1 170px', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
              />
              <button onClick={() => setContractorProfileId(c.id)} style={{ ...removeBtnStyle, color: COLORS.blue700, borderColor: COLORS.blue100 }}>
                View →
              </button>
            </div>
            <input
              type="text"
              value={c.notes || ''}
              placeholder="Notes (optional — specialty, rates, anything worth flagging)"
              onChange={(e) => updateContractorField(c.id, 'notes', e.target.value)}
              onBlur={() => persistContractor(c.id)}
              style={{ width: '100%', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
        ))}
      </SettingsSection>

      {/* Section 3: Compliance Check Types */}
      <SettingsSection
        title="Compliance Check Types"
        subtitle="Manage which safety checks builders can run, their category, and the score each item carries if it fails."
        open={!!openSections['compliance-types']}
        onToggle={() => toggleSection('compliance-types')}
        headerExtra={
          <button onClick={(e) => { e.stopPropagation(); startAddType() }} style={stickyAddBtnStyle}>
            ＋ Add Check Type
          </button>
        }
      >
        {addingType && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', padding: '12px', background: COLORS.teal50, border: `1px solid ${COLORS.teal300}`, borderRadius: '10px' }}>
            <input
              type="text"
              autoFocus
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmAddType(); if (e.key === 'Escape') cancelAddType() }}
              placeholder="New check type name..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={confirmAddType} style={{ padding: '10px 16px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Create</button>
            <button onClick={cancelAddType} style={{ padding: '10px 16px', background: COLORS.white, color: COLORS.slate500, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          </div>
        )}

        {complianceTypes.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No compliance check types yet.</p>
        )}

        {complianceTypes.map((type, idx) => {
          const isExpanded = !!expandedTypes[type.id]
          const orderValue = typeOrderDrafts[type.id] ?? String(idx + 1)
          const orderInput = (
            <input
              type="number"
              min={1}
              max={complianceTypes.length}
              value={orderValue}
              title="Position — type a number to move this check type"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => handleTypeOrderInputChange(type.id, e.target.value)}
              onBlur={() => commitTypeOrder(type.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
              style={orderInputStyle}
            />
          )
          return (
          <div
            key={type.id}
            style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '16px', marginBottom: '12px', background: type.enabled ? COLORS.white : COLORS.slate50 }}
          >

            {isExpanded ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => toggleTypeExpanded(type.id)}
                  title="Collapse"
                  style={expandToggleBtnStyle}
                >
                  ▲
                </button>
                {orderInput}
                <button
                  onClick={() => toggleCheckTypeEnabled(type.id)}
                  title={type.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  style={{
                    width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: type.enabled ? COLORS.teal600 : COLORS.slate300, color: COLORS.white, fontSize: '16px',
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
                  style={{ flex: '2 1 220px', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontWeight: 700, color: COLORS.slate900, boxSizing: 'border-box' }}
                />
                <select
                  value={type.category}
                  onChange={(e) => updateCheckTypeCategory(type.id, e.target.value)}
                  style={{ flex: '1 1 170px', height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', background: COLORS.white }}
                >
                  {CATEGORY_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <button
                  onClick={() => requestRemoveType(type.id)}
                  style={removeBtnStyle}
                >
                  ✕ Remove
                </button>
              </div>
            ) : (
              <div
                onClick={() => toggleTypeExpanded(type.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flexWrap: 'wrap' }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); toggleTypeExpanded(type.id) }}
                  title="Expand"
                  style={expandToggleBtnStyle}
                >
                  ▼
                </button>
                {orderInput}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleCheckTypeEnabled(type.id) }}
                  title={type.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  style={{
                    width: '36px', height: '36px', borderRadius: '8px', border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: type.enabled ? COLORS.teal600 : COLORS.slate300, color: COLORS.white, fontSize: '16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  👁
                </button>
                <span style={{ flex: '2 1 220px', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{type.name}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate500, flexShrink: 0 }}>{type.category}</span>
                <span style={countChipStyle}>{type.items.length} item{type.items.length === 1 ? '' : 's'}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); requestRemoveType(type.id) }}
                  style={removeBtnStyle}
                >
                  ✕ Remove
                </button>
              </div>
            )}

            {isExpanded && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px', marginTop: '14px' }}>
                  {type.items.length === 0 && (
                    <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate400, fontStyle: 'italic' }}>No checklist items yet.</p>
                  )}
                  {type.items.map((item, idx) => {
                    const tier = tierForScore(item.score)
                    return (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <span style={{ width: '18px', fontSize: '12px', color: COLORS.slate400, flexShrink: 0, marginTop: '10px' }}>{idx + 1}.</span>
                        <input
                          ref={(el) => { itemInputRefs.current[item.id] = el }}
                          type="text"
                          value={item.label}
                          onChange={(e) => updateItemLabel(type.id, item.id, e.target.value)}
                          onBlur={handleItemLabelBlur}
                          style={{ flex: 1, height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                          <input
                            type="number"
                            min={0}
                            max={150}
                            value={item.score}
                            onChange={(e) => updateItemScore(type.id, item.id, e.target.value)}
                            style={{ width: '70px', height: '36px', padding: '0 8px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', textAlign: 'center', boxSizing: 'border-box' }}
                          />
                          <span style={{ fontSize: '10px', fontWeight: 700, color: tier.color, marginTop: '3px', whiteSpace: 'nowrap' }}>{tier.label}</span>
                        </div>
                        <button
                          onClick={() => removeChecklistItem(type.id, item.id)}
                          style={{ width: '32px', height: '36px', background: COLORS.white, color: COLORS.red600, border: `1px solid ${COLORS.red200}`, borderRadius: '8px', fontSize: '13px', cursor: 'pointer', flexShrink: 0 }}
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>

                <button
                  onClick={() => addChecklistItem(type.id)}
                  style={{ width: '100%', padding: '10px', border: `2px dashed ${COLORS.slate300}`, background: 'none', color: COLORS.slate500, borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  ＋ Add checklist item
                </button>
              </>
            )}
          </div>
          )
        })}
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
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>How long before a clocked-in job shows the overrun warning.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Done window (hours)</label>
            <input
              type="number"
              value={doneWindowHours}
              onChange={(e) => setDoneWindowHours(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>How long completed jobs remain visible to builders.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Clock-in distance threshold (metres)</label>
            <input
              type="number"
              value={clockDistanceThresholdM}
              onChange={(e) => setClockDistanceThresholdM(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Clock-in/out points further than this from the property are flagged on the Clocking page.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Flagged locations lookback (days)</label>
            <input
              type="number"
              value={clockFlagLookbackDays}
              onChange={(e) => setClockFlagLookbackDays(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>How far back the Dashboard's "Flagged Locations" tile looks -- older flags age out on their own. The Clocking page itself still shows every flag, all-time.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Long break alert (minutes)</label>
            <input
              type="number"
              min="5"
              step="5"
              value={longBreakAlertMinutes}
              onChange={(e) => setLongBreakAlertMinutes(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>A builder locked to a break timer (Going to the Office / Lunch Break / getting materials themselves) this long alerts their manager, once per break.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Long-running job alert (hours)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={longRunningJobAlertHours}
              onChange={(e) => setLongRunningJobAlertHours(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>A single job still "In Progress" this long alerts the builder's manager, once per stretch -- separate from the "Over 8h" row on the Clocking page, which only shows up if a manager happens to look.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Idle alert (minutes)</label>
            <input
              type="number"
              min="5"
              step="5"
              value={idleAlertMinutes}
              onChange={(e) => setIdleAlertMinutes(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>A builder not working on anything this long, despite already having an Assigned job waiting, alerts their manager, once per idle stretch.</p>
          </div>
        </div>

        <button onClick={saveClockingRules} disabled={clockingSaving} style={{ ...saveBtnStyle, opacity: clockingSaving ? 0.6 : 1, cursor: clockingSaving ? 'not-allowed' : 'pointer' }}>
          {clockingSaving ? 'Saving...' : 'Save Clocking Rules'}
        </button>
        {clockingSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4a2: Daily Attendance */}
      <SettingsSection
        title="Daily Attendance"
        subtitle="Builders and every manager-tier role (not Admin) must clock in for the day before they can see their jobs or dashboard at all -- separate from clocking in/out of an individual job."
        open={!!openSections['daily-attendance']}
        onToggle={() => toggleSection('daily-attendance')}
      >
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Clock-in deadline (UK time)</label>
            <input
              type="time"
              value={dailyClockInDeadline}
              onChange={(e) => setDailyClockInDeadline(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Clocking in after this time is flagged as late on the Clocking page.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Clock-out reminder (UK time)</label>
            <input
              type="time"
              value={dailyClockOutReminderTime}
              onChange={(e) => setDailyClockOutReminderTime(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>A builder still clocked in for the day past this time gets a one-off push reminder to clock out.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Overtime threshold (hours/day)</label>
            <input
              type="number"
              min="1"
              step="0.5"
              value={overtimeThresholdHours}
              onChange={(e) => setOvertimeThresholdHours(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>A day totalling more than this many clocked hours is flagged as overtime, on the builder's profile and their own Metrics page.</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Stale shift threshold (hours)</label>
            <input
              type="number"
              min="1"
              step="0.5"
              value={staleShiftHours}
              onChange={(e) => setStaleShiftHours(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>A shift still open past this many hours, into a new day, locks the builder out and pushes every admin/manager to close it out for them by hand -- this one never auto closes, even with the setting below (it's for a shift that's already sat open overnight, well past a same-day grace period).</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={fieldLabelStyle}>Auto clock-out grace period (minutes)</label>
            <input
              type="number"
              min="15"
              step="15"
              value={autoClockOutGraceMinutes}
              onChange={(e) => setAutoClockOutGraceMinutes(e.target.value)}
              style={inputStyle}
            />
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>If a builder is still clocked in this long past the clock-out reminder above, and neither they nor a manager has closed the shift by then, the system clocks them out itself -- backdated to the reminder time, not whenever this actually ran. Managers get their own alert 15 minutes before this fires, so there's a real chance to step in first.</p>
          </div>
        </div>

        <button onClick={saveDailyAttendanceSettings} disabled={dailyAttendanceSaving} style={{ ...saveBtnStyle, opacity: dailyAttendanceSaving ? 0.6 : 1, cursor: dailyAttendanceSaving ? 'not-allowed' : 'pointer' }}>
          {dailyAttendanceSaving ? 'Saving...' : 'Save Daily Attendance Settings'}
        </button>
        {dailyAttendanceSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4b: Stuck Ticket Alerts */}
      <SettingsSection
        title="Stuck Ticket Alerts"
        subtitle="How long a ticket can sit in a status before it's flagged as stuck on the Pipeline page and managers are pushed an alert. Thresholds scale by priority tier."
        open={!!openSections['stuck-ticket-alerts']}
        onToggle={() => toggleSection('stuck-ticket-alerts')}
      >
        <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '520px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0 12px 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</th>
                {STUCK_TIERS.map(tier => (
                  <th key={tier} style={{ textAlign: 'left', padding: '0 12px 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tier}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STUCK_STATUSES.map(status => (
                <tr key={status}>
                  <td style={{ padding: '6px 12px 6px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900, whiteSpace: 'nowrap' }}>{statusLabel(status)}</td>
                  {STUCK_TIERS.map(tier => {
                    const cell = stuckThresholds[status]?.[tier] || { value: '', unit: 'hours' }
                    return (
                      <td key={tier} style={{ padding: '6px 12px 6px 0' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            type="number"
                            value={cell.value}
                            onChange={(e) => updateStuckThresholdCell(status, tier, 'value', e.target.value)}
                            style={{ ...inputStyle, width: '70px' }}
                          />
                          <select
                            value={cell.unit}
                            onChange={(e) => updateStuckThresholdCell(status, tier, 'unit', e.target.value)}
                            style={{ ...inputStyle, width: '90px' }}
                          >
                            <option value="hours">hours</option>
                            <option value="days">days</option>
                          </select>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, marginBottom: '16px' }}>
          <input type="checkbox" checked={stuckAlertsEnabled} onChange={(e) => setStuckAlertsEnabled(e.target.checked)} />
          Send push notifications for stuck tickets
        </label>

        <button onClick={saveStuckTicketAlerts} disabled={stuckAlertsSaving} style={{ ...saveBtnStyle, opacity: stuckAlertsSaving ? 0.6 : 1, cursor: stuckAlertsSaving ? 'not-allowed' : 'pointer' }}>
          {stuckAlertsSaving ? 'Saving...' : 'Save Stuck Ticket Alerts'}
        </button>
        {stuckAlertsSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4c: Compliance Alerts */}
      <SettingsSection
        title="Compliance Alerts"
        subtitle="How many days before a certificate/inspection expiry it's flagged as due-soon across the portfolio. Push notifications only fire once a record actually expires."
        open={!!openSections['compliance-alerts']}
        onToggle={() => toggleSection('compliance-alerts')}
      >
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Days before expiry to flag as due-soon</label>
          <input
            type="number"
            value={complianceAgingThresholdDays}
            onChange={(e) => setComplianceAgingThresholdDays(e.target.value)}
            style={inputStyle}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, marginBottom: '16px' }}>
          <input type="checkbox" checked={complianceAlertsEnabled} onChange={(e) => setComplianceAlertsEnabled(e.target.checked)} />
          Send push notifications when a certificate expires
        </label>

        <button onClick={saveComplianceAlerts} disabled={complianceAlertsSaving} style={{ ...saveBtnStyle, opacity: complianceAlertsSaving ? 0.6 : 1, cursor: complianceAlertsSaving ? 'not-allowed' : 'pointer' }}>
          {complianceAlertsSaving ? 'Saving...' : 'Save Compliance Alerts'}
        </button>
        {complianceAlertsSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4d: Void Aging Alerts */}
      <SettingsSection
        title="Void Aging Alerts"
        subtitle="How many days a room can sit void before it's flagged as overdue across the portfolio. Push notifications only fire once a void passes this threshold."
        open={!!openSections['void-aging-alerts']}
        onToggle={() => toggleSection('void-aging-alerts')}
      >
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Days void before flagged as overdue</label>
          <input
            type="number"
            value={voidAgingThresholdDays}
            onChange={(e) => setVoidAgingThresholdDays(e.target.value)}
            style={inputStyle}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, marginBottom: '16px' }}>
          <input type="checkbox" checked={voidAlertsEnabled} onChange={(e) => setVoidAlertsEnabled(e.target.checked)} />
          Send push notifications when a void passes the threshold
        </label>

        <button onClick={saveVoidAlerts} disabled={voidAlertsSaving} style={{ ...saveBtnStyle, opacity: voidAlertsSaving ? 0.6 : 1, cursor: voidAlertsSaving ? 'not-allowed' : 'pointer' }}>
          {voidAlertsSaving ? 'Saving...' : 'Save Void Aging Alerts'}
        </button>
        {voidAlertsSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4d-2: Sign-Off Threshold */}
      <SettingsSection
        title="Sign-Off Threshold"
        subtitle="How long a completed job can sit waiting for the submitter to sign it off before the Sign-Off Oversight page flags it in red."
        open={!!openSections['sign-off-threshold']}
        onToggle={() => toggleSection('sign-off-threshold')}
      >
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Flag as overdue after</label>
          <select
            value={signOffThresholdHours}
            onChange={(e) => setSignOffThresholdHours(e.target.value)}
            style={inputStyle}
          >
            <option value={24}>24 hours</option>
            <option value={48}>48 hours</option>
            <option value={72}>72 hours</option>
            <option value={168}>1 week</option>
            <option value={336}>2 weeks</option>
            <option value={720}>1 month</option>
          </select>
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Measured from when the job was completed. Doesn't affect anything until a sign-off KPI is actually built on top of it.</p>
        </div>

        <button onClick={saveSignOffThreshold} disabled={signOffThresholdSaving} style={{ ...saveBtnStyle, opacity: signOffThresholdSaving ? 0.6 : 1, cursor: signOffThresholdSaving ? 'not-allowed' : 'pointer' }}>
          {signOffThresholdSaving ? 'Saving...' : 'Save Sign-Off Threshold'}
        </button>
        {signOffThresholdSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4e: Routine Cleaning Visits (Cleaners Rota) */}
      <SettingsSection
        title="Routine Cleaning Visits"
        subtitle="How many days after a property's last routine visit (or since a cleaner was assigned, if there's no visit yet) a new visit is automatically created on the cleaner's job list."
        open={!!openSections['routine-visit-alerts']}
        onToggle={() => toggleSection('routine-visit-alerts')}
      >
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Days since last visit before a new one is created</label>
          <input
            type="number"
            value={routineVisitFlagDays}
            onChange={(e) => setRoutineVisitFlagDays(e.target.value)}
            style={inputStyle}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, marginBottom: '16px' }}>
          <input type="checkbox" checked={routineVisitAlertsEnabled} onChange={(e) => setRoutineVisitAlertsEnabled(e.target.checked)} />
          Automatically create routine visit jobs
        </label>

        {/* These jobs go straight to the assigned cleaner with no manager
            in the loop, so there's no assignment step to type an estimate
            into -- this is the closest equivalent, applied to every job
            this automation creates rather than left blank. */}
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Estimated time for each auto-created visit (minutes)</label>
          <input
            type="number"
            value={routineVisitEstimatedMinutes}
            onChange={(e) => setRoutineVisitEstimatedMinutes(e.target.value)}
            style={inputStyle}
          />
        </div>

        <button onClick={saveRoutineVisitAlerts} disabled={routineVisitSaving} style={{ ...saveBtnStyle, opacity: routineVisitSaving ? 0.6 : 1, cursor: routineVisitSaving ? 'not-allowed' : 'pointer' }}>
          {routineVisitSaving ? 'Saving...' : 'Save Routine Visit Settings'}
        </button>
        {routineVisitSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4f2: Gardens */}
      <SettingsSection
        title="Gardens"
        subtitle="How often a garden needs servicing, based on the current UK season (Mar-Oct counts as summer, Nov-Feb as winter). Drives both the dashboard's Overdue Gardens tile and the daily auto-ticket check below -- no more switching a single number by hand as the seasons change."
        open={!!openSections['garden-review']}
        onToggle={() => toggleSection('garden-review')}
      >
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div style={{ maxWidth: '260px' }}>
            <label style={fieldLabelStyle}>Summer service interval (days)</label>
            <input
              type="number"
              value={gardenServiceDaysSummer}
              onChange={(e) => setGardenServiceDaysSummer(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ maxWidth: '260px' }}>
            <label style={fieldLabelStyle}>Winter service interval (days)</label>
            <input
              type="number"
              value={gardenServiceDaysWinter}
              onChange={(e) => setGardenServiceDaysWinter(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, marginBottom: '16px' }}>
          <input type="checkbox" checked={gardenAutoTicketEnabled} onChange={(e) => setGardenAutoTicketEnabled(e.target.checked)} />
          Automatically raise a ticket when a garden becomes due (lands unassigned -- a manager still picks who does it)
        </label>

        <button onClick={saveGardenReviewSettings} disabled={gardenReviewSaving} style={{ ...saveBtnStyle, opacity: gardenReviewSaving ? 0.6 : 1, cursor: gardenReviewSaving ? 'not-allowed' : 'pointer' }}>
          {gardenReviewSaving ? 'Saving...' : 'Save Garden Review Settings'}
        </button>
        {gardenReviewSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 4f: Routine Visit Checklist (Cleaners Rota) */}
      <SettingsSection
        title="Routine Visit Checklist"
        subtitle="The baseline a cleaner must work through before a routine visit can be marked complete. Photos and a note are captured on top of this, not instead of it."
        open={!!openSections['routine-visit-checklist']}
        onToggle={() => toggleSection('routine-visit-checklist')}
      >
        {routineVisitChecklist.length === 0 && (
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No checklist items yet.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
          {routineVisitChecklist.map(item => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 12px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{item}</span>
              <button
                onClick={() => handleDeleteChecklistItem(item)}
                style={{ background: 'none', border: 'none', color: COLORS.red600, fontSize: '12px', fontWeight: 800, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newChecklistItem}
            onChange={(e) => setNewChecklistItem(e.target.value)}
            placeholder="New checklist item..."
            style={{ ...inputStyle, flex: '1 1 220px' }}
          />
          <button
            onClick={handleAddChecklistItem}
            disabled={checklistSaving}
            style={{ padding: '10px 20px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: checklistSaving ? 'not-allowed' : 'pointer', opacity: checklistSaving ? 0.6 : 1 }}
          >
            {checklistSaving ? 'Saving...' : '+ Add Item'}
          </button>
        </div>
        {checklistError && <p style={modalErrorStyle}>{checklistError}</p>}
      </SettingsSection>

      {/* Section 4f-2: Material Stores (Builder Leaving Site -- Buying Materials) */}
      <SettingsSection
        title="Material Stores"
        subtitle="Suggestions offered on the builder's Buying Materials page. Typing anything not on this list is still accepted as free text -- this is just the type-ahead. Turn a store off rather than deleting it to keep past trips readable."
        open={!!openSections['material-stores']}
        onToggle={() => toggleSection('material-stores')}
      >
        {materialStores.length === 0 && (
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No stores added yet.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
          {materialStores.map(store => (
            <div key={store.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 12px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, minWidth: 0 }}>
                <input type="checkbox" checked={store.active} onChange={() => handleToggleMaterialStoreActive(store.name)} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: store.active ? COLORS.slate900 : COLORS.slate400 }}>{store.name}{!store.active ? ' (inactive)' : ''}</span>
              </label>
              <button
                onClick={() => handleDeleteMaterialStore(store.name)}
                style={{ background: 'none', border: 'none', color: COLORS.red600, fontSize: '12px', fontWeight: 800, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newMaterialStore}
            onChange={(e) => setNewMaterialStore(e.target.value)}
            placeholder="New store name..."
            style={{ ...inputStyle, flex: '1 1 220px' }}
          />
          <button
            onClick={handleAddMaterialStore}
            disabled={materialStoreSaving}
            style={{ padding: '10px 20px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: materialStoreSaving ? 'not-allowed' : 'pointer', opacity: materialStoreSaving ? 0.6 : 1 }}
          >
            {materialStoreSaving ? 'Saving...' : '+ Add Store'}
          </button>
        </div>
        {materialStoreError && <p style={modalErrorStyle}>{materialStoreError}</p>}
      </SettingsSection>

      {/* Section 4g: Towns / Areas */}
      <SettingsSection
        title="Towns / Areas"
        subtitle="The list of towns/cities properties can be tagged with, so the portfolio can be filtered by area on the Properties page."
        open={!!openSections['towns-areas']}
        onToggle={() => toggleSection('towns-areas')}
      >
        {towns.length === 0 && (
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No towns added yet.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
          {towns.map(town => (
            <div key={town} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 12px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{town}</span>
              <button
                onClick={() => handleDeleteTown(town)}
                title="Remove from the picklist -- properties already tagged with this town keep it, they just won't be able to change to it again unless it's re-added"
                style={{ background: 'none', border: 'none', color: COLORS.red600, fontSize: '12px', fontWeight: 800, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={newTownName}
            onChange={(e) => setNewTownName(e.target.value)}
            placeholder="New town/city..."
            style={{ ...inputStyle, flex: '1 1 220px' }}
          />
          <button
            onClick={handleAddTown}
            disabled={townSaving}
            style={{ padding: '10px 20px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: townSaving ? 'not-allowed' : 'pointer', opacity: townSaving ? 0.6 : 1 }}
          >
            {townSaving ? 'Saving...' : '+ Add Town'}
          </button>
        </div>
        {townError && <p style={modalErrorStyle}>{townError}</p>}
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
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Properties added within this window count toward the "New Properties" dashboard tile.</p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={fieldLabelStyle}>Total Tickets period</label>
          <select
            value={totalTicketsPeriod}
            onChange={(e) => setTotalTicketsPeriod(e.target.value)}
            style={inputStyle}
          >
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
            <option value="all_time">All Time</option>
          </select>
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Controls what the "Total Tickets" dashboard tile counts, so it doesn't grow into an unwieldy all-time number.</p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={fieldLabelStyle}>Daily Briefing / Where's the Team card height (px)</label>
          <input
            type="number"
            min="150"
            step="10"
            value={dashboardCardHeightPx}
            onChange={(e) => setDashboardCardHeightPx(e.target.value)}
            style={{ ...inputStyle, maxWidth: '160px' }}
          />
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Height of the two side-by-side cards at the top of the dashboard. Content inside scrolls once it runs past this, rather than growing the card.</p>
        </div>

        <button onClick={saveDashboardMetrics} disabled={dashboardMetricsSaving} style={{ ...saveBtnStyle, opacity: dashboardMetricsSaving ? 0.6 : 1, cursor: dashboardMetricsSaving ? 'not-allowed' : 'pointer' }}>
          {dashboardMetricsSaving ? 'Saving...' : 'Save Dashboard Metrics'}
        </button>
        {dashboardMetricsSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Appearance -- KPI tile sizing lived as hardcoded values in
          shared.jsx's KpiTiles until this, meaning every tweak needed a
          code change and a deploy. This is the self-service version. */}
      <SettingsSection
        title="Appearance"
        subtitle="Controls how KPI tiles look across the whole app -- the dashboard, Pipeline, Sign-Off, and every division page."
        open={!!openSections['appearance']}
        onToggle={() => toggleSection('appearance')}
      >
        <div style={{ marginBottom: '16px' }}>
          <label style={fieldLabelStyle}>KPI tile height (padding, px)</label>
          <input
            type="number"
            min="4"
            max="24"
            step="1"
            value={kpiTilePaddingPx}
            onChange={(e) => setKpiTilePaddingPx(e.target.value)}
            style={{ ...inputStyle, maxWidth: '160px' }}
          />
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>Higher = taller, more spaced-out tiles (feels more like a card); lower = flatter, more compact (feels more like a button). Still shrinks further on narrow screens regardless of this value.</p>
        </div>

        <button onClick={saveAppearance} disabled={appearanceSaving} style={{ ...saveBtnStyle, opacity: appearanceSaving ? 0.6 : 1, cursor: appearanceSaving ? 'not-allowed' : 'pointer' }}>
          {appearanceSaving ? 'Saving...' : 'Save Appearance'}
        </button>
        {appearanceSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {/* Section 7: AI Usage Pricing */}
      <SettingsSection
        title="AI Usage Pricing"
        subtitle="Cost per query on the Reports page's AI question box (Claude Haiku 4.5) is computed from these rates. Leave blank and cost shows as unknown rather than $0."
        open={!!openSections['ai-pricing']}
        onToggle={() => toggleSection('ai-pricing')}
      >
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Input cost ($ per million tokens)</label>
          <input
            type="number" step="0.01" placeholder="e.g. 1.00"
            value={aiInputCostPerMillion}
            onChange={(e) => setAiInputCostPerMillion(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Output cost ($ per million tokens)</label>
          <input
            type="number" step="0.01" placeholder="e.g. 5.00"
            value={aiOutputCostPerMillion}
            onChange={(e) => setAiOutputCostPerMillion(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: '16px', maxWidth: '260px' }}>
          <label style={fieldLabelStyle}>Rows per page in the AI Usage log</label>
          <input
            type="number" min="1" step="1"
            value={aiUsageLogPageSize}
            onChange={(e) => setAiUsageLogPageSize(e.target.value)}
            style={inputStyle}
          />
        </div>
        <button onClick={saveAiPricing} disabled={aiPricingSaving} style={{ ...saveBtnStyle, opacity: aiPricingSaving ? 0.6 : 1, cursor: aiPricingSaving ? 'not-allowed' : 'pointer' }}>
          {aiPricingSaving ? 'Saving...' : 'Save AI Pricing'}
        </button>
        {aiPricingSaved && <span style={savedTagStyle}>✓ Saved</span>}
      </SettingsSection>

      {pendingRemoval && (
        <div style={modalOverlayStyle} onClick={() => setPendingRemoval(null)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <p style={modalTitleStyle}>Remove "{pendingRemoval.label}"?</p>
            <p style={modalSubtitleStyle}>
              {pendingRemoval.kind === 'category'
                ? 'This removes the category and all of its sub-categories. This can\'t be undone.'
                : 'This removes the check type and all of its checklist items. This can\'t be undone.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => setPendingRemoval(null)} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={confirmPendingRemoval} style={{ ...modalConfirmBtnStyle, background: COLORS.red600 }}>✕ Remove</button>
            </div>
          </div>
        </div>
      )}

      {contractorProfileId && (
        <ContractorProfileModal contractorId={contractorProfileId} onClose={() => setContractorProfileId(null)} />
      )}

    </div>
  )
}
