import { useState, useEffect, useRef } from 'react'
import { COLORS } from '../lib/colors'

// Every build gets a unique ID (see vite.config.js's write-build-id plugin)
// baked into the bundle as __BUILD_ID__ and also dropped as a plain
// build-id.txt file alongside it. This polls that file -- once on load, again
// whenever the tab regains focus, and every few minutes while it stays open
// -- and surfaces this badge the moment the two differ, so a push actually
// reaches whoever's already got PMMS open instead of relying on them knowing
// to hard-refresh (found live: a fix went out but a tab left open overnight
// kept behaving the old way). Deliberately a click, not an automatic reload
// -- that would risk wiping out whatever someone's mid-typing the moment a
// deploy happens to land.
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
    <button
      onClick={() => window.location.reload()}
      title="A new version of PMMS is available — click to refresh"
      aria-label="A new version of PMMS is available — click to refresh"
      style={{
        position: 'fixed', bottom: '20px', right: '20px', zIndex: 999999,
        width: '52px', height: '52px', borderRadius: '50%', border: 'none',
        background: COLORS.teal600, color: COLORS.white, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '22px', lineHeight: 1, boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
        animation: 'pulse 2s ease-in-out infinite',
      }}
    >
      🔄
    </button>
  )
}
