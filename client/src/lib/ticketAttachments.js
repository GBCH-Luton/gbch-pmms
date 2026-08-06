import { supabase } from './supabase'
import { compressImage } from './imageCompression'
import { getSignedUrl } from './storage'

// Shared by every "log a ticket" form (AdminRaiseTicket.jsx,
// SubmitterDashboard.jsx, BuilderDashboard.jsx) -- uploads each file to the
// existing ticket-photos bucket, compressing images (compressImage is a
// no-op pass-through for video), then rows every URL into
// pmms.ticket_attachments against the given ticket. Returns the list of
// signed URLs in the same order as the input files, so the caller can also
// keep writing the first one into tickets.photo_url for backward
// compatibility with older single-photo display sites.
export async function uploadTicketAttachments(files, ticketId, uploaderId) {
  const urls = []
  for (const file of files) {
    const compressed = await compressImage(file)
    const path = `${uploaderId}/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('ticket-photos').upload(path, compressed)
    if (uploadError) throw new Error(`Media upload failed: ${uploadError.message}`)

    const url = await getSignedUrl('ticket-photos', path)
    urls.push(url)
  }

  if (urls.length > 0) {
    const { error } = await supabase.schema('pmms').from('ticket_attachments').insert(
      urls.map(url => ({ ticket_id: ticketId, url }))
    )
    if (error) throw new Error(`Saving attachments failed: ${error.message}`)
  }

  return urls
}

// Attachment rows only exist for tickets raised after this feature shipped
// -- older tickets have nothing here, so every display site falls back to
// the ticket's own photo_url/completion_photo_url when this comes back
// empty rather than assuming a gallery always exists.
export async function fetchTicketAttachments(ticketId) {
  const { data } = await supabase
    .schema('pmms')
    .from('ticket_attachments')
    .select('id, url, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at')
  return data || []
}
