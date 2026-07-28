import { useState, useEffect, useRef } from 'react'
import { getImpersonationMarker, returnToAdmin } from '../lib/impersonation'

// Rendered once in App.jsx, above <Routes>, rather than duplicated into
// AdminDashboard.jsx/BuilderDashboard.jsx. BuilderDashboard's main views are
// all `position: fixed; inset: 0` full-viewport panels (and AdminDashboard's
// sidebar is `position: sticky; top: 0`), so this banner sets a CSS variable
// on the document root with its own real height -- those panels read
// `var(--pmms-banner-offset, 0px)` instead of a bare `0`/`inset: 0`, so they
// get pushed down exactly enough to clear the banner instead of being
// covered by it (found live: it was hiding BuilderDashboard's ticket-detail
// back button).
export default function ImpersonationBanner() {
  const marker = getImpersonationMarker()
  const [returning, setReturning] = useState(false)
  const [returnError, setReturnError] = useState('')
  const barRef = useRef(null)

  useEffect(() => {
    if (marker && barRef.current) {
      document.documentElement.style.setProperty('--pmms-banner-offset', `${barRef.current.offsetHeight}px`)
    } else {
      document.documentElement.style.setProperty('--pmms-banner-offset', '0px')
    }
    return () => document.documentElement.style.setProperty('--pmms-banner-offset', '0px')
  }, [marker])

  if (!marker) return null

  async function handleReturn() {
    setReturning(true)
    setReturnError('')
    const { error } = await returnToAdmin()
    // returnToAdmin() always clears the marker before returning, even on
    // failure (falling back to a forced sign-out) -- so this component
    // unmounts on the next render either way. The error/reset below is
    // just a defensive fallback in case that assumption is ever wrong.
    if (error) {
      setReturnError(error)
      setReturning(false)
    }
    // On success, App.jsx's onAuthStateChange (SIGNED_IN, suppressed)
    // resolves the admin's own profile again; routing redirects to /admin
    // on its own -- no navigation call needed here.
  }

  return (
    <div ref={barRef} style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999999,
      background: '#b45309', color: '#fff', padding: '8px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
      fontSize: '13px', fontWeight: 700, fontFamily: 'system-ui, sans-serif',
    }}>
      <span>Viewing as {marker.targetName}</span>
      <button
        onClick={handleReturn}
        disabled={returning}
        style={{
          background: '#fff', color: '#b45309', border: 'none', borderRadius: '6px',
          padding: '4px 12px', fontWeight: 700, cursor: returning ? 'default' : 'pointer',
        }}
      >
        {returning ? 'Returning…' : 'Return to my account'}
      </button>
      {returnError && <span style={{ fontWeight: 500 }}>{returnError}</span>}
    </div>
  )
}
