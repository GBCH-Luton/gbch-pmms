import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
// Side-effect import: patches the shared supabase client to report failed
// queries. Must run before App renders and fires any query.
import { logClientError } from './lib/errorLog'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import App from './App.jsx'

window.onerror = (message, source, lineno, colno, error) => {
  logClientError('js_error', error?.message || message, {
    stack: error?.stack,
    context: { source, lineno, colno },
  })
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  logClientError('unhandled_rejection', reason?.message || String(reason), {
    stack: reason?.stack,
  })
})

// Registered unconditionally (not just when someone opts into push
// notifications via enablePushNotifications()) so the app actually meets
// browsers' "installable" criteria for everyone. Safe to call again there
// too -- registering the same script twice just returns the existing
// registration.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal -- push opt-in will retry */ })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
)
