import { Component } from 'react'
import { logClientError } from '../lib/errorLog'
import { COLORS } from '../lib/colors'

// Matches Chrome ("Failed to fetch dynamically imported module"), Firefox
// ("error loading dynamically imported module") and Safari's own wording
// for the same failure: a lazy-loaded page's chunk no longer exists at its
// old filename because a newer deploy replaced it, and this tab has been
// open since before that. Confirmed live 2026-08-21 via pmms.error_logs.
const CHUNK_LOAD_ERROR_PATTERN = /dynamically imported module|importing a module script failed|loading chunk/i
const CHUNK_RELOAD_GUARD_KEY = 'pmms_chunk_error_reloaded'
// How long a guard trip blocks a repeat auto-reload for. Short enough that
// a genuinely broken deploy (same error immediately after reloading) still
// falls through to the manual card instead of looping forever; long enough
// that it's clearly not just an artifact of the reload itself. Anything
// older than this is treated as a brand new staleness event -- found live
// 2026-08-24: with no expiry at all, only the FIRST deploy of a day with
// several pushes ever got auto-recovered; every deploy after that hit the
// same already-tripped guard and fell straight to the manual card instead.
const CHUNK_RELOAD_GUARD_MS = 60000

export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    logClientError('react_render', error.message, {
      stack: error.stack,
      context: { componentStack: info.componentStack },
    })

    // Deliberately narrower than the auto-reloads removed 2026-08-21 (JWT
    // expiry, tab-switch) -- those could interrupt a screen someone was
    // actively using. This one can't: the crash happens while loading a NEW
    // page's code, before it ever mounts, so there's nothing in progress on
    // screen to lose. sessionStorage (not a plain variable) survives the
    // reload itself; the guard is a timestamp, not a plain one-time flag,
    // so a genuinely new staleness event (another deploy landing later the
    // same tab session) still gets its own auto-reload -- only a repeat
    // failure within CHUNK_RELOAD_GUARD_MS of the last one falls through to
    // the manual card, on the theory that reloading clearly didn't help.
    try {
      const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) || 0)
      if (CHUNK_LOAD_ERROR_PATTERN.test(error?.message || '') && Date.now() - lastReload > CHUNK_RELOAD_GUARD_MS) {
        sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(Date.now()))
        window.location.reload()
      }
    } catch {
      // sessionStorage unavailable (private browsing edge cases) -- fall
      // through to the manual card, same as any other unmatched error.
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '12px', fontFamily: 'system-ui', background: COLORS.slate50, padding: '20px', textAlign: 'center',
      }}>
        <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Something went wrong.</p>
        <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate500, maxWidth: '360px' }}>
          Please refresh the page. If this keeps happening, let your admin know.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: '8px', padding: '10px 20px', background: COLORS.blue700, color: COLORS.white, border: 'none',
            borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
