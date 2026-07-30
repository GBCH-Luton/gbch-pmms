import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import logo from '../assets/gbch-logo.svg'

export default function SetPassword({ profile, onDone }) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit() {
    setError('')

    if (!password.trim() || !confirmPassword.trim()) { setError('Please fill in both fields.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }

    setLoading(true)

    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setLoading(false)
      setError(updateError.message || 'Unable to update password. Please try again.')
      return
    }

    // Clear the force-reset flag
    const { error: clearError } = await supabase.functions.invoke('clear-force-reset-flag')
    if (clearError) {
      setLoading(false)
      setError('Password was updated, but something went wrong finishing setup. Please contact your admin.')
      return
    }

    setLoading(false)
    setSuccess(true)

    await onDone?.()
    setTimeout(() => navigate('/', { replace: true }), 1800)
  }

  return (
    <div style={{
      minHeight: '100%',
      background: `linear-gradient(160deg, ${COLORS.brandNavy} 0%, ${COLORS.brandNavyMid} 60%, ${COLORS.brandNavyLight} 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '40px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <img src={logo} alt="GBCH Logo" style={{ height: '52px', width: 'auto', marginBottom: '10px' }} />
          <h1 style={{ fontSize: '30px', fontWeight: 800, color: COLORS.white, margin: '0 0 6px 0', letterSpacing: '-0.03em', lineHeight: 1 }}>
            Set a new password
          </h1>
        </div>

        <div style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '20px',
          padding: '32px',
          backdropFilter: 'blur(12px)',
        }}>
          {!success ? (
            <>
              <div style={{ padding: '12px 14px', background: 'rgba(217,119,6,0.15)', border: '1px solid rgba(217,119,6,0.3)', color: COLORS.amber300, borderRadius: '10px', fontSize: '13px', marginBottom: '22px', lineHeight: 1.5 }}>
                🔒 Your password was reset by an administrator. Please set a new password to continue — you cannot access the system until you do.
              </div>

              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  style={{ width: '100%', padding: '13px 15px', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: '12px', background: 'rgba(255,255,255,0.07)', color: COLORS.white, fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="Re-enter your new password"
                  style={{ width: '100%', padding: '13px 15px', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: '12px', background: 'rgba(255,255,255,0.07)', color: COLORS.white, fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {error && (
                <div style={{ padding: '12px 14px', background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)', color: COLORS.red300, borderRadius: '10px', fontSize: '13px', marginTop: '16px' }}>
                  ⚠️ {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading}
                style={{ width: '100%', padding: '14px', marginTop: '24px', background: loading ? 'rgba(255,255,255,0.1)' : `linear-gradient(135deg, ${COLORS.blue600}, ${COLORS.blue700})`, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 4px 20px rgba(37,99,235,0.4)', letterSpacing: '0.02em' }}>
                {loading ? 'Setting password...' : 'Set password →'}
              </button>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <p style={{ fontSize: '15px', fontWeight: 700, color: COLORS.green300, margin: 0 }}>
                ✓ Password updated! Redirecting you in…
              </p>
              {profile?.name && (
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', marginTop: '8px' }}>Welcome back, {profile.name}.</p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
