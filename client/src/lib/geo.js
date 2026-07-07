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

// Best-effort current position -- resolves to null (never rejects) if the
// user denies permission, the browser doesn't support it, or it times out,
// so clocking in/out is never blocked by a location prompt.
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
      .from('properties')
      .update({ postcode, latitude: coords.latitude, longitude: coords.longitude })
      .eq('id', p.id)
  }

  return coordsByPropertyId
}
