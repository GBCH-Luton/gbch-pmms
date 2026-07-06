import { supabase } from './supabase'

// Bug fix: AdminRaiseTicket.jsx and BuilderDashboard.jsx both used to define
// their own hardcoded copy of the compliance check types/checklists, so
// editing them on the Admin Settings page ("Compliance Check Types") saved
// to pmms.settings but was never actually read by either ticket-raising
// screen. This is now the single source of truth both the Settings page and
// the ticket-raising screens read from and fall back to.
export const DEFAULT_COMPLIANCE_CHECK_TYPES = [
  {
    id: 'fire-door-inspection',
    name: 'Fire Door Inspection',
    enabled: true,
    category: 'Doors/Locks',
    items: [
      { id: 'fdi-1', label: 'All fire doors close fully and latch on release', score: 70 },
      { id: 'fdi-2', label: 'No obstructions or items propping fire doors open', score: 60 },
      { id: 'fdi-3', label: 'Door seals / intumescent strips intact and undamaged', score: 50 },
    ],
  },
  {
    id: 'fire-alarm-detection',
    name: 'Fire Alarm & Detection',
    enabled: true,
    category: 'Electricity',
    items: [
      { id: 'fad-1', label: 'Alarm control panel shows no active faults', score: 80 },
      { id: 'fad-2', label: 'Test call point sounds correctly throughout building', score: 75 },
      { id: 'fad-3', label: 'Smoke/heat detectors free from dust, paint, or obstruction', score: 65 },
    ],
  },
  {
    id: 'fire-extinguishers',
    name: 'Fire Extinguishers',
    enabled: true,
    category: 'Other / Unlisted Trade',
    items: [
      { id: 'fe-1', label: 'Extinguishers present at all designated points', score: 65 },
      { id: 'fe-2', label: 'Pressure gauge needle sits in the green zone', score: 60 },
      { id: 'fe-3', label: 'Service tag is within annual inspection date', score: 45 },
    ],
  },
  {
    id: 'emergency-lighting-routes',
    name: 'Emergency Lighting & Routes',
    enabled: true,
    category: 'Electricity',
    items: [
      { id: 'elr-1', label: 'Emergency lighting activates correctly on test', score: 70 },
      { id: 'elr-2', label: 'Escape routes and corridors clear of obstruction', score: 65 },
      { id: 'elr-3', label: 'Fire exit signage visible, lit, and undamaged', score: 55 },
    ],
  },
]

// Returns only the check types an admin has left enabled -- matches what
// the Settings page subtitle promises ("which safety checks builders can run").
export async function fetchComplianceCheckTypes() {
  const { data } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'compliance_check_types')
    .maybeSingle()

  const raw = data?.setting_value
  const types = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_COMPLIANCE_CHECK_TYPES
  return types.filter(t => t.enabled !== false)
}
