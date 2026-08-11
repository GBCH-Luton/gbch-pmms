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

// Same effect as supabase.storage.from(bucket).upload(), but via a raw XHR
// POST against the documented Storage REST endpoint (a plain binary body +
// Content-Type header -- no multipart, per Supabase's own upload docs)
// instead of the JS SDK's fetch() call, purely because fetch gives no way
// to observe upload progress and XHR does. Built for video attachments,
// which are large enough on-site mobile data that "is this stuck?" was a
// real complaint (see uploadTicketAttachments) -- everything else about
// the request (path, auth, bucket) is identical to the SDK's own upload.
export async function uploadFileWithProgress(bucket, path, file, onProgress) {
  const { data: { session } } = await supabase.auth.getSession()
  const baseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${baseUrl}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${session?.access_token ?? anonKey}`)
    xhr.setRequestHeader('apikey', anonKey)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('cache-control', '3600')
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve() }
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed: network error'))
    xhr.send(file)
  })
}
