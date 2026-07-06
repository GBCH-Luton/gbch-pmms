import { useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/gbch-logo.svg'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleLogin() {
    if (!email.trim() || !password.trim()) { setError('Please enter your email and password'); return }
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100%',
      background: 'linear-gradient(160deg, #0D1B3E 0%, #0A2444 60%, #0D2F5E 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '40px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        {/* Logo + Title */}
<div style={{ marginBottom: '40px', textAlign: 'center' }}>
  <img src={logo} alt="GBCH Logo" style={{ height: '52px', width: 'auto', marginBottom: '10px' }} />
  <h1 style={{ fontSize: '36px', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0', letterSpacing: '-0.03em', lineHeight: 1 }}>
    PMMS
  </h1>
  <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.45)', margin: 0, fontWeight: 500 }}>
    Property Maintenance Management System
  </p>
</div>


        {/* Form card */}
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '20px',
          padding: '32px',
          backdropFilter: 'blur(12px)',
        }}>
          <p style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff', margin: '0 0 24px 0' }}>Sign in to your account</p>

          <div style={{ marginBottom: '18px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Work email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@greenbridgehousing.org"
              style={{ width: '100%', padding: '13px 15px', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: '12px', background: 'rgba(255,255,255,0.07)', color: '#ffffff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Enter your password"
              style={{ width: '100%', padding: '13px 15px', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: '12px', background: 'rgba(255,255,255,0.07)', color: '#ffffff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {error && (
            <div style={{ padding: '12px 14px', background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)', color: '#fca5a5', borderRadius: '10px', fontSize: '13px', marginTop: '16px' }}>
              ⚠️ {error}
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            style={{ width: '100%', padding: '14px', marginTop: '24px', background: loading ? 'rgba(255,255,255,0.1)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 4px 20px rgba(37,99,235,0.4)', letterSpacing: '0.02em' }}>
            {loading ? 'Signing in...' : 'Sign in →'}
          </button>

          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', marginTop: '20px', textAlign: 'center' }}>
            Forgotten your password? Contact your manager or admin.
          </p>
        </div>

      </div>
    </div>
  )
}
