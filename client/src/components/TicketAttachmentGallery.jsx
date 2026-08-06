import { useEffect, useState } from 'react'
import AttachmentMedia from './AttachmentMedia'
import { fetchTicketAttachments } from '../lib/ticketAttachments'

// Shows every photo/video attached to a ticket, for the detail-level views
// (Pipeline's ticket modal, Sign-Off, Builder's job detail) -- not list
// thumbnails, which stay on the single legacy photo_url to avoid a
// per-row fetch. Tickets raised before this feature existed have no
// ticket_attachments rows at all, so this falls back to fallbackUrl
// (tickets.photo_url/completion_photo_url) whenever the gallery is empty.
export default function TicketAttachmentGallery({ ticketId, fallbackUrl, mediaHeight = '140px' }) {
  const [attachments, setAttachments] = useState(null) // null = loading

  useEffect(() => {
    let cancelled = false
    if (!ticketId) { setAttachments([]); return }
    fetchTicketAttachments(ticketId).then(rows => { if (!cancelled) setAttachments(rows) })
    return () => { cancelled = true }
  }, [ticketId])

  if (attachments === null) return null

  const urls = attachments.length > 0 ? attachments.map(a => a.url) : (fallbackUrl ? [fallbackUrl] : [])
  if (urls.length === 0) return null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
      {urls.map((url, idx) => (
        <AttachmentMedia key={idx} url={url} alt="Ticket attachment" style={{ width: '100%', height: mediaHeight, objectFit: 'cover', borderRadius: '10px', display: 'block' }} />
      ))}
    </div>
  )
}
