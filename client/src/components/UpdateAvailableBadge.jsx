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
const MOBILE_BREAKPOINT_PX = 640

export default function UpdateAvailableBadge() {
  const [available, setAvailable] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX)
  const checkingRef = useRef(false)
  const knownRef = useRef(false)

  // A plain resize listener, not a CSS media query -- this codebase has no
  // existing pattern for injecting media-query CSS from a component, and a
  // single formula trying to serve both a small desktop corner box and a
  // full-width mobile bar is exactly what went wrong twice already (see
  // [[project_update_toast_mobile_fix]]) -- two genuinely separate layouts
  // driven by a JS breakpoint sidesteps that whole class of bug instead of
  // trying to find a cleverer CSS formula for it.
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT_PX)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  // Mobile: a full-width bar pinned to the bottom edge -- unmissable and
  // impossible to overflow off-screen since it has no computed width at
  // all. Desktop: back to the original small corner box (the user
  // confirmed that one was already fine) -- a plain auto-width box needs
  // no width formula either, since it just sizes to its own content.
  const containerStyle = isMobile
    ? {
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 999999,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '10px 16px',
        background: COLORS.slate900, color: COLORS.white,
        padding: '16px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif', fontSize: '15px',
      }
    : {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: 999999,
        display: 'flex', alignItems: 'center', gap: '12px',
        background: COLORS.slate900, color: COLORS.white,
        borderRadius: '10px', padding: '10px 12px 10px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif', fontSize: '13px',
      }

  return (
    <div role="status" style={containerStyle}>
      <span style={{ fontWeight: 700, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>A new update is available</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          background: COLORS.blue600, color: COLORS.white, border: 'none',
          borderRadius: isMobile ? '8px' : '6px', padding: isMobile ? '10px 24px' : '6px 14px',
          fontSize: isMobile ? '15px' : '13px', fontWeight: 700,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        Update
      </button>
    </div>
  )
}
