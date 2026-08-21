import { Component } from 'react'
import { logClientError } from '../lib/errorLog'
import { COLORS } from '../lib/colors'

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
