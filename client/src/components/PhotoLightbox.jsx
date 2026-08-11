import { useEffect } from 'react'
import { COLORS } from '../lib/colors'
import { isVideoAttachment } from './AttachmentMedia'

// In-page photo viewer -- click a thumbnail to see it large without
// navigating away (a new tab loses the chat/page context, which is why a
// plain target="_blank" link wasn't the right fix). Click the backdrop or
// image to close.
//
// Two ways to call it: a single `url` (Team Chat, no navigation needed --
// one photo per message), or `urls` + `index` for a gallery with
// Prev/Next (Pipeline/Sign-Off/Builder job photos via
// TicketAttachmentGallery) -- `onNavigate(newIndex)` is required for the
// arrows to do anything.
export default function PhotoLightbox({ url, urls, index = 0, onClose, onNavigate }) {
  const photos = urls && urls.length > 0 ? urls : (url ? [url] : [])
  const hasMultiple = photos.length > 1
  const safeIndex = photos.length > 0 ? ((index % photos.length) + photos.length) % photos.length : 0
  const current = photos[safeIndex]

  useEffect(() => {
    if (!hasMultiple || !onNavigate) return
    function onKeyDown(e) {
      if (e.key === 'ArrowLeft') onNavigate((safeIndex - 1 + photos.length) % photos.length)
      if (e.key === 'ArrowRight') onNavigate((safeIndex + 1) % photos.length)
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasMultiple, onNavigate, safeIndex, photos.length, onClose])

  if (!current) return null

  function goPrev(e) { e.stopPropagation(); onNavigate?.((safeIndex - 1 + photos.length) % photos.length) }
  function goNext(e) { e.stopPropagation(); onNavigate?.((safeIndex + 1) % photos.length) }

  const navBtnStyle = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: '44px', height: '44px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.15)', border: 'none', color: COLORS.white, fontSize: '22px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200000, background: 'rgba(15,23,42,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', cursor: 'pointer',
      }}
    >
      {isVideoAttachment(current)
        ? <video src={current} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }} />
        : <img src={current} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }} />}

      {hasMultiple && (
        <>
          <button onClick={goPrev} aria-label="Previous photo" style={{ ...navBtnStyle, left: '16px' }}>‹</button>
          <button onClick={goNext} aria-label="Next photo" style={{ ...navBtnStyle, right: '16px' }}>›</button>
          <span style={{
            position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            fontSize: '12px', fontWeight: 700, color: COLORS.white, background: 'rgba(0,0,0,0.4)', padding: '4px 10px', borderRadius: '999px',
          }}>
            {safeIndex + 1} / {photos.length}
          </span>
        </>
      )}

      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute', top: '16px', right: '16px', width: '36px', height: '36px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.15)', border: 'none', color: COLORS.white, fontSize: '18px', cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  )
}
