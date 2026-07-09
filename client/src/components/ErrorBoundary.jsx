import { Component } from 'react'
import { logClientError } from '../lib/errorLog'

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
        gap: '12px', fontFamily: 'system-ui', background: '#f8fafc', padding: '20px', textAlign: 'center',
      }}>
        <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Something went wrong.</p>
        <p style={{ margin: 0, fontSize: '14px', color: '#64748b', maxWidth: '360px' }}>
          Please refresh the page. If this keeps happening, let your admin know.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: '8px', padding: '10px 20px', background: '#1d4ed8', color: '#fff', border: 'none',
            borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
