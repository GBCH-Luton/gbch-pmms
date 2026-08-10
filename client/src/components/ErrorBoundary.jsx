import { Component } from 'react'
import { logClientError } from '../lib/errorLog'
import { COLORS } from '../lib/colors'

// A deploy renames every JS chunk (content-hashed filenames) -- a tab left
// open from before a deploy still has the OLD hash baked into its already-
// loaded index bundle, so the next lazy import (opening a page for the
// first time this session) 404s. Not a real bug, just a stale tab. Chrome
// and Firefox word the resulting TypeError differently, hence two patterns.
const STALE_CHUNK_PATTERN = /(error loading|failed to fetch) dynamically imported module/i
const LAST_RELOAD_KEY = 'pmms_chunk_reload_at'
// If a stale-chunk error happens again within this window, the reload we
// just did didn't fix it -- likely a genuinely broken deploy -- so stop
// looping. Past this window, treat it as a brand new, unrelated deploy
// (a tab commonly lives across several deploys in one browsing session)
// and give it its own fresh reload attempt rather than staying silent
// forever because some earlier deploy already used up a one-per-tab flag.
const RELOOP_GUARD_MS = 15000

export default class ErrorBoundary extends Component {
  state = { hasError: false, isStaleChunk: false, reloadLooped: false }

  static getDerivedStateFromError(error) {
    return { hasError: true, isStaleChunk: STALE_CHUNK_PATTERN.test(error?.message || '') }
  }

  componentDidCatch(error, info) {
    const isStaleChunk = STALE_CHUNK_PATTERN.test(error.message || '')

    if (isStaleChunk) {
      const lastReload = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || 0)
      const loopedRecently = Date.now() - lastReload < RELOOP_GUARD_MS
      if (loopedRecently) {
        // The auto-reload below already ran once and didn't fix it -- a
        // genuinely broken deploy, not just a stale tab. This is the one
        // stale-chunk case actually worth a log entry.
        logClientError('react_render', error.message, {
          stack: error.stack,
          context: { componentStack: info.componentStack },
        })
        this.setState({ reloadLooped: true })
        return
      }

      // Reload once, automatically, instead of showing a scary "something
      // went wrong" card for what's really just "you need the newer
      // version". Every tab left open across a deploy hits this, which is
      // constant and never actionable -- not logged, so it stops burying
      // real crashes under noise (see the not-a-bug case this recovers
      // from, e.g. 2026-08-10's Abu-Sayed Kalam entry).
      sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()))
      window.location.reload()
      return
    }

    logClientError('react_render', error.message, {
      stack: error.stack,
      context: { componentStack: info.componentStack },
    })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.state.isStaleChunk && !this.state.reloadLooped) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '12px', fontFamily: 'system-ui', background: COLORS.slate50, padding: '20px', textAlign: 'center',
        }}>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: COLORS.slate500 }}>Loading the latest version...</p>
        </div>
      )
    }

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
