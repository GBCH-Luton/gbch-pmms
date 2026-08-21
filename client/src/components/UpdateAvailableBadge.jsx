import { useState, useEffect, useRef } from 'react'
import { COLORS } from '../lib/colors'

// Every build gets a unique ID (see vite.config.js's write-build-id plugin)
// baked into the bundle as __BUILD_ID__ and also dropped as a plain
// build-id.txt file alongside it. This polls that file -- once on load, again
// whenever the tab regains focus, and every few minutes while it stays open
// -- and surfaces this toast the moment the two differ, so a push actually
// reaches whoever's already got PMMS open instead of relying on them knowing
// to hard-refresh (found live: a fix went out but a tab left open overnight
// kept behaving the old way). Clicking "Update" reloads; it never reloads on
// its own, since that would risk wiping out whatever someone's mid-typing
// the moment a deploy happens to land -- but there's no dismiss either, on
// purpose, so it can't get waved away and forgotten before the tab ever
// picks up the fix it's there for.
export default function UpdateAvailableBadge() {
  const [available, setAvailable] = useState(false)
  const checkingRef = useRef(false)
  const knownRef = useRef(false)

  useEffect(() => {
    async function check() {
      if (checkingRef.current || knownRef.current) return
      checkingRef.current = true
      try {
        const res = await fetch(`/build-id.txt?t=${Date.now()}`, { cache: 'no-store' })
        if (res.ok) {
          const liveBuildId = (await res.text()).trim()
          if (liveBuildId && liveBuildId !== __BUILD_ID__) {
            knownRef.current = true
            setAvailable(true)
          }
        }
      } catch { /* offline or blocked -- next check tries again */ }
      checkingRef.current = false
    }

    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(check, 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [])

  if (!available) return null

  return (
    <div
      role="status"
      style={{
        position: 'fixed', bottom: '20px', right: '20px', zIndex: 999999,
        display: 'flex', alignItems: 'center', gap: '12px',
        background: COLORS.slate900, color: COLORS.white,
        borderRadius: '10px', padding: '10px 12px 10px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      }}
    >
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>A new update is available</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: COLORS.blue600, color: COLORS.white, border: 'none',
          borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: 700,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        Update
      </button>
    </div>
  )
}
