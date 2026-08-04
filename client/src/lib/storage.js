import { supabase } from './supabase'

// ticket-photos / property-photos / property-docs / chat-photos are all
// private buckets (staff-photos is the one exception -- see resolveStaffPhotoUrl
// in pages/admin/shared.jsx -- it's owned by another company system sharing
// this database, left public, not ours to change). A plain getPublicUrl()
// no longer resolves to anything readable, so every upload site signs a URL
// at upload time and stores THAT string instead -- same shape as the old
// public URL, ready to use directly in an <img src>, rather than needing
// every display site to re-sign on every render.
//
// 10 years is effectively permanent for a business tool that has no
// delete/rotate flow today (see the storage-organization discussion this
// came out of) -- revisit if that ever changes.
const SIGNED_URL_EXPIRY_SECONDS = 10 * 365 * 24 * 60 * 60

export async function getSignedUrl(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS)
  return error ? null : data.signedUrl
}
