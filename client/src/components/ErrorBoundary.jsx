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
    // reload itself, so this only ever retries once per tab -- if the
    // deploy is genuinely broken and reloading doesn't help, it falls
    // through to the manual card below instead of looping forever.
    try {
      if (CHUNK_LOAD_ERROR_PATTERN.test(error?.message || '') && !sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, '1')
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
