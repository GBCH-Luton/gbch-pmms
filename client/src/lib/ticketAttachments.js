import { supabase } from './supabase'
import { compressImage } from './imageCompression'
import { compressVideo } from './videoCompression'
import { getSignedUrl, uploadFileWithProgress } from './storage'

// Shared by every "log a ticket" form (AdminRaiseTicket.jsx,
// SubmitterDashboard.jsx, BuilderDashboard.jsx) *and* BuilderDashboard's
// job-completion flow -- uploads each file to the existing ticket-photos
// bucket, compressing images and videos first (compressVideo silently
// falls back to the original file wherever the browser can't do the
// re-encode), then rows every URL into pmms.ticket_attachments against the
// given ticket. Returns the list of signed URLs in the same order as the
// input files, so the caller can also keep writing the first one into
// tickets.photo_url/completion_photo_url for backward compatibility with
// older single-photo display sites.
//
// attachmentStage: 'reported' (default) or 'completed' -- the same table
// holds both now, so every reader needs to filter by this to keep "what he
// reported" and "what he did to fix it" apart (see
// fetchTicketAttachments/TicketAttachmentGallery below).
//
// onProgress, if given, is called repeatedly with
// { index, total, stage: 'compressing' | 'uploading', pct } so a large
// video doesn't just sit behind a static "Submitting..." label -- see the
// "uploads take forever" investigation this was built for. (Unrelated to
// attachmentStage -- this `stage` is the upload lifecycle, that one is the
// ticket lifecycle; both happened to already be named "stage" in their own
// contexts.)
export async function uploadTicketAttachments(files, ticketId, uploaderId, { onProgress, attachmentStage = 'reported' } = {}) {
  const urls = []
  let index = 0
  for (const file of files) {
    index += 1
    const isVideo = file.type.startsWith('video/')
    const compressed = isVideo
      ? await compressVideo(file, { onProgress: pct => onProgress?.({ index, total: files.length, stage: 'compressing', pct }) })
      : await compressImage(file)

    const path = `${uploaderId}/${Date.now()}-${compressed.name}`
    await uploadFileWithProgress('ticket-photos', path, compressed, pct => onProgress?.({ index, total: files.length, stage: 'uploading', pct }))

    const url = await getSignedUrl('ticket-photos', path)
    urls.push(url)
  }

  if (urls.length > 0) {
    const { error } = await supabase.schema('pmms').from('ticket_attachments').insert(
      urls.map(url => ({ ticket_id: ticketId, url, stage: attachmentStage }))
    )
    if (error) throw new Error(`Saving attachments failed: ${error.message}`)
  }

  return urls
}

// Turns the { index, total, stage, pct } shape uploadTicketAttachments
// reports into the one string every "log a ticket" form's submit button
// needs -- kept here so the wording only exists once.
export function formatUploadProgress(progress) {
  if (!progress) return null
  const stageLabel = progress.stage === 'compressing' ? 'Compressing video' : 'Uploading'
  const fileLabel = progress.total > 1 ? ` (${progress.index}/${progress.total})` : ''
  return `${stageLabel}${fileLabel}... ${progress.pct}%`
}

// Attachment rows only exist for tickets raised (or, for 'completed',
// completed) after each feature shipped -- older tickets have nothing
// here, so every display site falls back to the ticket's own
// photo_url/completion_photo_url when this comes back empty rather than
// assuming a gallery always exists.
export async function fetchTicketAttachments(ticketId, attachmentStage = 'reported') {
  const { data } = await supabase
    .schema('pmms')
    .from('ticket_attachments')
    .select('id, url, created_at')
    .eq('ticket_id', ticketId)
    .eq('stage', attachmentStage)
    .order('created_at')
  return data || []
}
