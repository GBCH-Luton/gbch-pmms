import { COLORS } from '../lib/colors'

// Minimal in-page photo viewer -- click a thumbnail to see it large without
// navigating away (a new tab loses the chat/page context, which is why a
// plain target="_blank" link wasn't the right fix). Click anywhere to close.
export default function PhotoLightbox({ url, onClose }) {
  if (!url) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200000, background: 'rgba(15,23,42,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', cursor: 'pointer',
      }}
    >
      <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }} />
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
