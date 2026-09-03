// Near-live staff tracking, Option 1 (2026-09-03, mocked up and approved
// first -- see the "Live Tracking Preview" artifact). Pings the current GPS
// position into pmms.staff_live_locations every ~75s while someone's
// clocked in AND has the app open in the foreground -- never in the
// background, never outside a shift. See
// scripts/add_staff_live_locations.sql for the table this depends on.
// Feeds the "Where's the Team" card and map's live layer
// (pages/admin/AdminDashboard.jsx, components/StaffLocationsMapModal.jsx).
import { useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { getCurrentPositionSafe } from './geo'

const PING_INTERVAL_MS = 75000

export function useLiveLocationPing(enabled, staffId) {
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!enabled || !staffId) return

    let cancelled = false

    async function ping() {
      // Page Visibility API -- skip while the tab's backgrounded or the
      // screen's locked, rather than burning a GPS fix (and battery)
      // nobody's actually looking at. The row just goes stale until they
      // come back to the app, which is the whole "near-live, not
      // always-on" point (a phone browser can't do proper background
      // tracking anyway -- see the artifact's own limitations callout).
      if (document.visibilityState !== 'visible') return
      const pos = await getCurrentPositionSafe(8000)
      if (cancelled || !pos) return
      await supabase.schema('pmms').from('staff_live_locations').upsert({
        staff_id: staffId, lat: pos.latitude, lng: pos.longitude, updated_at: new Date().toISOString(),
      })
    }

    ping()
    intervalRef.current = setInterval(ping, PING_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalRef.current)
    }
  }, [enabled, staffId])
}
