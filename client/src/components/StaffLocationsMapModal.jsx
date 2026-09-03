import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { COLORS } from '../lib/colors'
import { modalOverlayStyle } from '../pages/admin/shared'

// A plain CSS pin instead of Leaflet's default marker images -- those ship
// as separate PNG files that need bundler-specific path plumbing to load
// correctly (a well-known Leaflet+Vite friction point). A divIcon sidesteps
// that entirely, and doubles as the literal "red pin" the user asked for.
const PIN_HTML = `<div style="
  width: 22px; height: 22px; border-radius: 50% 50% 50% 0; background: ${COLORS.red600};
  transform: rotate(-45deg); border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
"></div>`
const redPinIcon = L.divIcon({ className: '', html: PIN_HTML, iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22] })
// Same pin, plus an expanding ring (liveLocationRing, index.css) around it --
// the "this one's live right now" signal from the mockup. The ring sits in
// a sibling div, not nested inside the rotated pin, so it stays a normal
// circle instead of inheriting the pin's -45deg rotate.
const livePinIcon = L.divIcon({
  className: '',
  html: `<div style="position:relative; width:22px; height:22px;">
    <div style="position:absolute; inset:-7px; border-radius:50%; border:2px solid ${COLORS.green600}; animation: liveLocationRing 2s ease-out infinite;"></div>
    ${PIN_HTML}
  </div>`,
  iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22],
})

// Default centre/zoom when nobody has a known location yet (Luton, where
// the properties this app manages are clustered) -- never left blank/at
// (0,0), which would render an unhelpful mid-ocean map.
const FALLBACK_CENTER = [51.8787, -0.4200]
const FALLBACK_ZOOM = 12

// A live fix counts as "live" (ring + pulse + preferred over the
// last-known fallback) for this long after its own timestamp -- same
// window pages/admin/AdminDashboard.jsx uses for the 📍 button's pulse dot.
// Past this it's just a stale row; falls back to the ordinary last-known
// position instead, same as someone who was never pinged at all.
const LIVE_FRESH_MS = 3 * 60 * 1000

function freshnessLabel(updatedAt) {
  if (!updatedAt) return null
  const ms = Date.now() - new Date(updatedAt).getTime()
  if (ms < 60000) return 'just now'
  return `${Math.round(ms / 60000)}m ago`
}

// Resolves each staff entry to the one pair of coordinates actually worth
// plotting -- a fresh live fix when live tracking's switched on, else the
// ordinary last-known position (today's only source, and still the
// fallback for anyone not currently being pinged at all).
function resolvePosition(s, liveOn) {
  const liveFresh = liveOn && s.liveUpdatedAt && (Date.now() - new Date(s.liveUpdatedAt).getTime()) < LIVE_FRESH_MS
  if (liveFresh) return { lat: s.liveLat, lng: s.liveLng, live: true, updatedAt: s.liveUpdatedAt }
  if (s.lat != null && s.lng != null) return { lat: s.lat, lng: s.lng, live: false, updatedAt: null }
  return null
}

export default function StaffLocationsMapModal({ open, onClose, staff }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({}) // staffId -> { marker, lat, lng, live }
  // Default on -- matches the mockup ("Keep it as a view-refresh toggle,
  // recommended", 2026-09-03). Off just means "don't prefer/refresh live
  // fixes", the same static last-known snapshot this modal always showed.
  const [liveOn, setLiveOn] = useState(true)

  // Create the map once per open -- NOT on every `staff` update. The
  // parent (TeamWhereabouts) already refetches every 45s regardless of
  // this modal, so recreating the whole map (and refitting bounds) on
  // every one of those would auto-zoom out from under someone mid-look and
  // flash the pins instead of smoothly moving them.
  useEffect(() => {
    if (!open) return

    const map = L.map(mapContainerRef.current, { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM })
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    // Leaflet measures its container on init -- inside a freshly-opened
    // modal that size can be 0 for a frame or two while the overlay is
    // still laying out, leaving the map grey/broken until the next resize.
    // invalidateSize() on the next tick forces it to re-measure once the
    // modal has actually settled.
    const t = setTimeout(() => map.invalidateSize(), 50)

    return () => {
      clearTimeout(t)
      map.remove()
      mapRef.current = null
      markersRef.current = {}
    }
  }, [open])

  // Adds/moves/removes markers to match the current staff list, and fits
  // bounds only the first time pins actually appear -- every update after
  // that just repositions existing markers (Leaflet animates a marker's own
  // setLatLng smoothly) rather than re-centring the whole map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Two people can genuinely share one exact spot (e.g. a manager
    // visiting the same property a housekeeper is already on a job at --
    // found live) -- Leaflet stacks markers with identical coordinates
    // exactly on top of each other, silently hiding all but the last one
    // added. Spread same-spot markers into a small ring around the real
    // point instead, so every pin stays visible and clickable.
    const resolved = (staff || [])
      .map(s => ({ s, pos: resolvePosition(s, liveOn) }))
      .filter(r => r.pos)

    const groups = {}
    resolved.forEach(r => {
      const key = `${r.pos.lat.toFixed(5)},${r.pos.lng.toFixed(5)}`
      ;(groups[key] ||= []).push(r)
    })
    const OFFSET_DEGREES = 0.00012 // ~13m at this latitude, enough to separate pins without drifting off the real location
    resolved.forEach(r => {
      const key = `${r.pos.lat.toFixed(5)},${r.pos.lng.toFixed(5)}`
      const group = groups[key]
      if (group.length === 1) return
      const indexInGroup = group.indexOf(r)
      const angle = (2 * Math.PI * indexInGroup) / group.length
      r.pos = { ...r.pos, lat: r.pos.lat + OFFSET_DEGREES * Math.sin(angle), lng: r.pos.lng + OFFSET_DEGREES * Math.cos(angle) }
    })

    const seenIds = new Set()
    const hadNoMarkersYet = Object.keys(markersRef.current).length === 0

    resolved.forEach(({ s, pos }) => {
      seenIds.add(s.id)
      const label = `<b>${s.name}</b><br/>${pos.live ? `🟢 Live · updated ${freshnessLabel(pos.updatedAt)}` : s.status}${!pos.live && s.address ? `<br/>${s.address}` : ''}`
      const existing = markersRef.current[s.id]

      if (!existing) {
        const marker = L.marker([pos.lat, pos.lng], { icon: pos.live ? livePinIcon : redPinIcon })
          .addTo(map)
          .bindTooltip(label, { direction: 'top', offset: [0, -20] })
        markersRef.current[s.id] = { marker, lat: pos.lat, lng: pos.lng, live: pos.live }
        return
      }

      if (existing.lat !== pos.lat || existing.lng !== pos.lng) {
        existing.marker.setLatLng([pos.lat, pos.lng])
      }
      if (existing.live !== pos.live) {
        existing.marker.setIcon(pos.live ? livePinIcon : redPinIcon)
      }
      existing.marker.setTooltipContent(label)
      markersRef.current[s.id] = { ...existing, lat: pos.lat, lng: pos.lng, live: pos.live }
    })

    // Drop markers for anyone no longer located (e.g. clocked out since the
    // last refresh) instead of leaving a stale pin behind.
    Object.keys(markersRef.current).forEach(id => {
      if (seenIds.has(id)) return
      markersRef.current[id].marker.remove()
      delete markersRef.current[id]
    })

    if (hadNoMarkersYet && resolved.length > 0) {
      map.fitBounds(resolved.map(r => [r.pos.lat, r.pos.lng]), { padding: [40, 40], maxZoom: 15 })
    }
  }, [staff, liveOn, open])

  if (!open) return null

  const resolvedNow = (staff || []).map(s => resolvePosition(s, liveOn)).filter(Boolean)
  const locatedCount = resolvedNow.length
  const liveCount = resolvedNow.filter(p => p.live).length

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.white, borderRadius: '16px', width: '100%', maxWidth: '900px', maxHeight: '85vh', boxShadow: '0 10px 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${COLORS.slate200}`, gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>📍 Where's the Team — Map</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: COLORS.slate500 }}>
              {locatedCount === 0
                ? 'Nobody has a known location right now.'
                : `${locatedCount} of ${(staff || []).length} on shift located${liveCount > 0 ? ` · ${liveCount} live` : ''}.`}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => setLiveOn(v => !v)}
              title="On: pins auto-refresh and prefer a live GPS fix while it's fresh. Off: today's plain last-known snapshot, no auto-refresh."
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`,
                borderRadius: '20px', padding: '5px 6px 5px 12px', fontSize: '11.5px', fontWeight: 700, color: COLORS.slate600, cursor: 'pointer',
              }}
            >
              Live tracking
              <span style={{ width: '34px', height: '19px', borderRadius: '20px', background: liveOn ? COLORS.green600 : COLORS.slate300, position: 'relative', transition: 'background .15s' }}>
                <span style={{ position: 'absolute', top: '2px', left: liveOn ? '17px' : '2px', width: '15px', height: '15px', borderRadius: '50%', background: COLORS.white, transition: 'left .15s' }} />
              </span>
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', color: COLORS.slate400, cursor: 'pointer', lineHeight: 1, padding: '4px' }}>×</button>
          </div>
        </div>
        <div ref={mapContainerRef} style={{ flex: 1, minHeight: '420px' }} />
        <div style={{ padding: '9px 20px', borderTop: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, fontSize: '11px', color: COLORS.slate500 }}>
          <b style={{ color: COLORS.slate600 }}>Live</b> = a GPS fix under 3 minutes old, sent while that person has the app open on shift. A pin drops back to its last-known position once tracking goes stale (phone locked, app closed, or shift ended).
        </div>
      </div>
    </div>
  )
}
