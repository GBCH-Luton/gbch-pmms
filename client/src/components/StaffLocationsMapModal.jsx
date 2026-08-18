import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { COLORS } from '../lib/colors'
import { modalOverlayStyle } from '../pages/admin/shared'

// A plain CSS pin instead of Leaflet's default marker images -- those ship
// as separate PNG files that need bundler-specific path plumbing to load
// correctly (a well-known Leaflet+Vite friction point). A divIcon sidesteps
// that entirely, and doubles as the literal "red pin" the user asked for.
const redPinIcon = L.divIcon({
  className: '',
  html: `<div style="
    width: 22px; height: 22px; border-radius: 50% 50% 50% 0; background: ${COLORS.red600};
    transform: rotate(-45deg); border: 2px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  "></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
})

// Default centre/zoom when nobody has a known location yet (Luton, where
// the properties this app manages are clustered) -- never left blank/at
// (0,0), which would render an unhelpful mid-ocean map.
const FALLBACK_CENTER = [51.8787, -0.4200]
const FALLBACK_ZOOM = 12

export default function StaffLocationsMapModal({ open, onClose, staff }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const located = (staff || []).filter(s => s.lat != null && s.lng != null)

    const map = L.map(mapContainerRef.current, { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM })
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    located.forEach(s => {
      // Tooltip, not popup -- shows on hover (a popup needs a click to
      // open), which is what a quick "who's this pin" glance wants.
      const label = `<b>${s.name}</b><br/>${s.status}${s.address ? `<br/>${s.address}` : ''}`
      L.marker([s.lat, s.lng], { icon: redPinIcon })
        .addTo(map)
        .bindTooltip(label, { direction: 'top', offset: [0, -20] })
    })

    if (located.length > 0) {
      map.fitBounds(located.map(s => [s.lat, s.lng]), { padding: [40, 40], maxZoom: 15 })
    }

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
    }
  }, [open, staff])

  if (!open) return null

  const locatedCount = (staff || []).filter(s => s.lat != null && s.lng != null).length

  return (
    <div style={modalOverlayStyle} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.white, borderRadius: '16px', width: '100%', maxWidth: '900px', maxHeight: '85vh', boxShadow: '0 10px 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${COLORS.slate200}` }}>
          <div>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>📍 Where's the Team — Map</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: COLORS.slate500 }}>
              {locatedCount === 0
                ? 'Nobody has a known location right now.'
                : `Last known location for ${locatedCount} of ${(staff || []).length} on shift.`}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', color: COLORS.slate400, cursor: 'pointer', lineHeight: 1, padding: '4px' }}>×</button>
        </div>
        <div ref={mapContainerRef} style={{ flex: 1, minHeight: '420px' }} />
      </div>
    </div>
  )
}
