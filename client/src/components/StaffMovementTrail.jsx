import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { COLORS } from '../lib/colors'
import { fetchMovementTrail, ukDateKey, shiftDateKey, formatUKDateTime } from '../pages/admin/shared'

// Same fallback centre as StaffLocationsMapModal.jsx (Luton, where this
// company's properties are clustered) -- never left blank/at (0,0), which
// would render an unhelpful mid-ocean map when a day has no located stops.
const FALLBACK_CENTER = [51.8787, -0.4200]
const FALLBACK_ZOOM = 12

function stopIcon(label, colour, hot) {
  const size = hot ? 30 : 26
  return L.divIcon({
    className: '',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50% 50% 50% 0; background: ${colour};
      transform: rotate(-45deg); border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center;
    "><span style="transform: rotate(45deg); font-size: 11px; font-weight: 800; color: #fff;">${label}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  })
}

function stopColour(index, total) {
  if (index === 0) return COLORS.green600
  if (index === total - 1) return COLORS.red600
  return COLORS.blue600
}
function stopLabel(index, total) {
  if (index === 0) return 'S'
  if (index === total - 1) return 'E'
  return String(index + 1)
}

function timeRangeLabel(stop) {
  const start = formatUKDateTime(stop.at).split(' ').slice(-1)[0]
  if (!stop.endAt) return start
  const end = formatUKDateTime(stop.endAt).split(' ').slice(-1)[0]
  return `${start} – ${end}`
}

export default function StaffMovementTrail({ staffId }) {
  const [dateKey, setDateKey] = useState(ukDateKey())
  const [stops, setStops] = useState([])
  const [loading, setLoading] = useState(true)
  const [hotId, setHotId] = useState(null)

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const layerGroupRef = useRef(null)
  const markersRef = useRef({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchMovementTrail(staffId, dateKey).then(rows => {
      if (!cancelled) { setStops(rows); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [staffId, dateKey])

  // Map is created once and only ever repainted (not recreated) on new
  // data -- recreating it per fetch would drop the user's pan/zoom every
  // time they hover a stop, which re-renders this component via hotId.
  useEffect(() => {
    const map = L.map(mapContainerRef.current, { center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM })
    mapRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    const t = setTimeout(() => map.invalidateSize(), 50)
    return () => {
      clearTimeout(t)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (layerGroupRef.current) layerGroupRef.current.remove()
    const group = L.layerGroup().addTo(map)
    layerGroupRef.current = group
    markersRef.current = {}

    const located = stops.filter(s => s.lat != null && s.lng != null)
    if (located.length === 0) {
      map.setView(FALLBACK_CENTER, FALLBACK_ZOOM)
      return
    }

    if (located.length > 1) {
      L.polyline(located.map(s => [s.lat, s.lng]), {
        color: COLORS.blue600, weight: 3, opacity: 0.8, dashArray: '1 9', lineCap: 'round',
      }).addTo(group)
    }

    located.forEach((s, i) => {
      const marker = L.marker([s.lat, s.lng], { icon: stopIcon(stopLabel(i, located.length), stopColour(i, located.length), s.id === hotId) })
        .addTo(group)
        .bindTooltip(`<b>${s.title}</b>${s.subtitle ? `<br/>${s.subtitle}` : ''}<br/>${timeRangeLabel(s)}`, { direction: 'top', offset: [0, -24] })
      marker.on('mouseover', () => setHotId(s.id))
      marker.on('mouseout', () => setHotId(null))
      markersRef.current[s.id] = marker
    })

    map.fitBounds(located.map(s => [s.lat, s.lng]), { padding: [36, 36], maxZoom: 16 })
  }, [stops])

  // Re-icon only the hovered marker on hotId change, instead of rebuilding
  // every marker -- keeps hover from feeling laggy on a busy day.
  useEffect(() => {
    const located = stops.filter(s => s.lat != null && s.lng != null)
    located.forEach((s, i) => {
      const marker = markersRef.current[s.id]
      if (marker) marker.setIcon(stopIcon(stopLabel(i, located.length), stopColour(i, located.length), s.id === hotId))
    })
  }, [hotId, stops])

  const located = stops.filter(s => s.lat != null && s.lng != null)
  const unlocatedCount = stops.length - located.length
  const today = ukDateKey()
  const isToday = dateKey === today

  return (
    <div style={{ background: COLORS.white, borderRadius: '16px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 20px', borderBottom: `1px solid ${COLORS.slate100}`, flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>Movement Trail</p>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: COLORS.slate500 }}>
            {loading ? 'Loading...' : located.length === 0
              ? 'No located stops for this day.'
              : `${located.length} stop${located.length === 1 ? '' : 's'}${unlocatedCount > 0 ? ` · ${unlocatedCount} without a recorded location` : ''}`}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setDateKey(k => shiftDateKey(k, -1))}
            aria-label="Previous day"
            style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
          >‹</button>
          <input
            type="date"
            value={dateKey}
            max={today}
            onChange={(e) => e.target.value && setDateKey(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '12.5px', fontWeight: 600, color: COLORS.slate900 }}
          />
          <button
            onClick={() => setDateKey(k => shiftDateKey(k, 1))}
            disabled={isToday}
            aria-label="Next day"
            style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, fontSize: '13px', fontWeight: 700, cursor: isToday ? 'not-allowed' : 'pointer', opacity: isToday ? 0.4 : 1 }}
          >›</button>
          {!isToday && (
            <button
              onClick={() => setDateKey(today)}
              style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate600, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
            >Today</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 380px', minHeight: '320px', borderRight: `1px solid ${COLORS.slate100}`, position: 'relative' }}>
          <div ref={mapContainerRef} style={{ height: '100%', minHeight: '320px' }} />
        </div>

        <div style={{ flex: '1 1 260px', minHeight: '320px', maxHeight: '420px', overflowY: 'auto', padding: '12px' }}>
          {located.length === 0 && !loading ? (
            <p style={{ margin: '20px 12px', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>
              Nothing to show — either they weren't on shift this day, or no location was recorded.
            </p>
          ) : (
            located.map((s, i) => (
              <div
                key={s.id}
                onMouseEnter={() => setHotId(s.id)}
                onMouseLeave={() => setHotId(null)}
                style={{
                  display: 'flex', gap: '10px', padding: '9px 8px', borderRadius: '10px', cursor: 'default',
                  background: hotId === s.id ? COLORS.slate50 : 'transparent',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '22px' }}>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                    background: stopColour(i, located.length),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', fontWeight: 800, color: COLORS.white,
                  }}>
                    {stopLabel(i, located.length)}
                  </div>
                  {i < located.length - 1 && <div style={{ width: '2px', flex: 1, background: COLORS.slate200, marginTop: '2px', minHeight: '16px' }} />}
                </div>
                <div style={{ paddingBottom: '2px' }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{s.title}</p>
                  {s.subtitle && <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: COLORS.slate500 }}>{s.subtitle}</p>}
                  <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: COLORS.slate400, fontVariantNumeric: 'tabular-nums' }}>{timeRangeLabel(s)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
