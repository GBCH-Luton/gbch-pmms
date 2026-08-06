// Geo helpers for verifying a builder's clock-in/out location against the
// property they were assigned to. Geocoding goes through postcodes.io
// (free, no API key, built on Ordnance Survey open data) since every
// property address here is UK-postcode-shaped.

import { supabase } from './supabase'

const UK_POSTCODE_REGEX = /[A-Za-z]{1,2}[0-9][A-Za-z0-9]?\s*[0-9][A-Za-z]{2}/

export function extractUkPostcode(address) {
  if (!address) return null
  const match = address.match(UK_POSTCODE_REGEX)
  if (!match) return null
  return match[0].toUpperCase().replace(/\s+/g, ' ').trim()
}

export async function geocodePostcode(postcode) {
  if (!postcode) return null
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ''))}`)
    if (!res.ok) return null
    const json = await res.json()
    if (json.status !== 200 || !json.result) return null
    return { latitude: json.result.latitude, longitude: json.result.longitude }
  } catch {
    return null
  }
}

// Haversine distance in metres between two lat/lng points.
export function distanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Never rejects -- resolves to null if the user denies permission, the
// browser doesn't support it, or it times out, so a caller is never left
// handling a thrown error just to find out location isn't available. Most
// callers (clock-out, completion, pause, no-access) treat null as fine and
// carry on -- clocking IN specifically requires a real position before
// starting the job (BuilderDashboard.jsx's handleClockIn/handleResumeWork),
// since "no signal" is something a builder can walk outside and fix.
export function getCurrentPositionSafe(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) { resolve(null); return }
    const timer = setTimeout(() => resolve(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }) },
      () => { clearTimeout(timer); resolve(null) },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

export function googleMapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

// Google's plain query-string embed mode -- no API key/billing needed
// (this is the same free embedding Google already offers any website),
// unlike the full JS Maps SDK or the Directions API. Used to show a map
// inside an in-app modal instead of sending the manager to a new tab.
export function googleMapsEmbedLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}&output=embed`
}

// Same free embed mode, but with a start/end point -- Google draws the
// actual driving route between them (not just a straight line) inside
// its own embed UI. We still compute our own straight-line distance
// separately (distanceMetres) since the embed is a visual iframe, not a
// JSON API -- there's no number to read back out of it programmatically.
export function googleMapsRouteEmbedLink(lat1, lon1, lat2, lon2) {
  return `https://www.google.com/maps?saddr=${lat1},${lon1}&daddr=${lat2},${lon2}&output=embed`
}

export function metresToMiles(metres) {
  return metres / 1609.344
}

// A raw metre count (e.g. "1112m") is hard to read at a glance past a
// few hundred metres -- switches to km with one decimal place once it
// crosses 1000m, same reasoning as formatDurationDays switching from a
// plain hour count to "Xd Yh".
export function formatDistanceMetres(metres) {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)}km`
  return `${Math.round(metres)}m`
}

// Geocodes any of the given properties that don't have cached lat/lng yet
// (extracting the postcode from the address if needed), persists the
// result, and returns a { [propertyId]: { latitude, longitude } } map
// covering every property passed in (already-geocoded ones included).
export async function ensurePropertyCoords(properties) {
  const coordsByPropertyId = {}
  const toGeocode = []

  properties.forEach(p => {
    if (!p) return
    if (p.latitude != null && p.longitude != null) {
      coordsByPropertyId[p.id] = { latitude: p.latitude, longitude: p.longitude }
    } else {
      toGeocode.push(p)
    }
  })

  for (const p of toGeocode) {
    const postcode = p.postcode || extractUkPostcode(p.address)
    if (!postcode) continue
    const coords = await geocodePostcode(postcode)
    if (!coords) continue
    coordsByPropertyId[p.id] = coords
    await supabase
      .schema('pmms')
      .from('properties')
      .update({ postcode, latitude: coords.latitude, longitude: coords.longitude })
      .eq('id', p.id)
  }

  return coordsByPropertyId
}

// Same caching pattern as ensurePropertyCoords, but for a builder's home
// postcode (public.staff.home_postcode/home_latitude/home_longitude) --
// used by AdminClocking.jsx to estimate expected mileage for someone's
// first job of the day. Staff without a home_postcode set are silently
// skipped, not an error -- it's an optional field.
export async function ensureStaffHomeCoords(staffList) {
  const coordsByStaffId = {}
  const toGeocode = []

  staffList.forEach(s => {
    if (!s || !s.home_postcode) return
    if (s.home_latitude != null && s.home_longitude != null) {
      coordsByStaffId[s.id] = { latitude: s.home_latitude, longitude: s.home_longitude }
    } else {
      toGeocode.push(s)
    }
  })

  for (const s of toGeocode) {
    const coords = await geocodePostcode(s.home_postcode)
    if (!coords) continue
    coordsByStaffId[s.id] = coords
    await supabase
      .from('staff')
      .update({ home_latitude: coords.latitude, home_longitude: coords.longitude })
      .eq('id', s.id)
  }

  return coordsByStaffId
}
