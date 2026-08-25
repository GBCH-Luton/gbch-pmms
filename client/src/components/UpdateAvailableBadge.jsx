import { useState, useEffect, useRef } from 'react'
import { COLORS } from '../lib/colors'

// Every build gets a unique ID (see vite.config.js's write-build-id plugin)
// baked into the bundle as __BUILD_ID__ and also dropped as a plain
// build-id.txt file alongside it. This polls that file -- once on load, again
// whenever the tab regains focus, and every few minutes while it stays open
// -- and surfaces this toast the moment the two differ, so a push actually
// reaches whoever's already got PMMS open instead of relying on them knowing
// to hard-refresh (found live: a fix went out but a tab left open overnight
// kept behaving the old way). Clicking Update reloads; it never reloads on
// its own, since that would risk wiping out whatever someone's mid-typing
// the moment a deploy happens to land -- but there's no dismiss either, on
// purpose, so it can't get waved away and forgotten before the tab ever
// picks up the fix it's there for.
const MOBILE_BREAKPOINT_PX = 640

// A click can still land mid form-fill, so ask before actually discarding
// whatever wasn't saved yet -- confirmed as a real gap (raised 2026-08-25):
// reload has no undo. No equivalent guard on the auto-reload paths
// elsewhere (chunk-load recovery) since those only ever fire while loading
// a NEW page's code, before anything is on screen to lose.
function confirmAndReload() {
  if (window.confirm('Reload now to get the latest update? Anything unsaved on this page will be lost.')) {
    window.location.reload()
  }
}

export default function UpdateAvailableBadge() {
  const [available, setAvailable] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX)
  const checkingRef = useRef(false)
  const knownRef = useRef(false)

  // A plain resize listener, not a CSS media query -- this codebase has no
  // existing pattern for injecting media-query CSS from a component, and a
  // single formula trying to serve both a desktop toast and a mobile layout
  // is exactly what went wrong repeatedly already (see
  // [[project_update_toast_mobile_fix]]) -- two genuinely separate
  // renderings driven by a JS breakpoint sidesteps that whole class of bug.
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

  // Mobile: a small fixed-size icon button, not free-flowing text -- a
  // full-width bar and a wider text toast both broke differently on real
  // devices (see [[project_update_toast_mobile_fix]]); a small box with a
  // one-word label at a fixed size can't overflow or get clipped the way
  // wrapping text did.
  if (isMobile) {
    return (
      <button
        onClick={confirmAndReload}
        aria-label="A new update is available -- tap to refresh"
        style={{
          position: 'fixed', bottom: 'max(16px, env(safe-area-inset-bottom))', right: '16px', zIndex: 999999,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
          width: '60px', height: '60px', borderRadius: '16px', border: 'none',
          background: COLORS.blue600, color: COLORS.white,
          boxShadow: '0 8px 20px rgba(0,0,0,0.35)', cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span style={{ fontSize: '22px', lineHeight: 1 }}>↻</span>
        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.02em' }}>Update</span>
      </button>
    )
  }

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
        onClick={confirmAndReload}
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
