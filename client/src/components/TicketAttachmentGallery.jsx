import { useEffect, useState } from 'react'
import AttachmentMedia, { isVideoAttachment } from './AttachmentMedia'
import PhotoLightbox from './PhotoLightbox'
import { fetchTicketAttachments } from '../lib/ticketAttachments'
import { COLORS } from '../lib/colors'

// Shows every photo/video attached to a ticket, for the detail-level views
// (Pipeline's ticket modal, Sign-Off, Builder's job detail) -- not list
// thumbnails, which stay on the single legacy photo_url to avoid a
// per-row fetch. Tickets raised before this feature existed have no
// ticket_attachments rows at all, so this falls back to fallbackUrl
// (tickets.photo_url/completion_photo_url) whenever the gallery is empty.
//
// Every call site used to gate rendering this component on `photo_url`
// being set, on the wrong assumption that's still the source of truth --
// it isn't, ticket_attachments is, and photo_url is only a best-effort
// mirror of the first upload that doesn't always land (found live on
// ticket #36: a real attachment existed, but photo_url was null, so the
// whole gallery got hidden behind that check and never even tried to
// fetch it). Always render this component instead; it decides for itself
// whether there's anything to show. emptyLabel is optional so a caller
// that wants an explicit "No photo" placeholder still gets one.
export default function TicketAttachmentGallery({ ticketId, fallbackUrl, mediaHeight = '140px', emptyLabel }) {
  const [attachments, setAttachments] = useState(null) // null = loading
  const [lightboxIndex, setLightboxIndex] = useState(null) // index into imageUrls, or null

  useEffect(() => {
    let cancelled = false
    if (!ticketId) { setAttachments([]); return }
    fetchTicketAttachments(ticketId).then(rows => { if (!cancelled) setAttachments(rows) })
    return () => { cancelled = true }
  }, [ticketId])

  if (attachments === null) return null

  const urls = attachments.length > 0 ? attachments.map(a => a.url) : (fallbackUrl ? [fallbackUrl] : [])
  if (urls.length === 0) {
    if (!emptyLabel) return null
    return <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate400, fontStyle: 'italic' }}>{emptyLabel}</p>
  }

  // Videos already play in place (see AttachmentMedia) and were never
  // wrapped in the new-tab link this replaces, so only photos go through
  // the lightbox -- Next/Previous below steps through this photos-only
  // list, not the mixed photos+videos grid.
  const imageUrls = urls.filter(u => !isVideoAttachment(u))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
      {urls.map((url, idx) => {
        const imageIdx = imageUrls.indexOf(url)
        return (
          <AttachmentMedia
            key={idx}
            url={url}
            alt="Ticket attachment"
            style={{ width: '100%', height: mediaHeight, objectFit: 'cover', borderRadius: '10px', display: 'block' }}
            onClick={imageIdx !== -1 ? () => setLightboxIndex(imageIdx) : undefined}
          />
        )
      })}
      {lightboxIndex !== null && (
        <PhotoLightbox urls={imageUrls} index={lightboxIndex} onNavigate={setLightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </div>
  )
}
