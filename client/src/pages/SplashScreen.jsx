import logo from '../assets/gbch-logo.svg'
import { COLORS } from '../lib/colors'

// Shown while the app checks for a saved login session -- same background as
// Login so the transition into it feels seamless rather than a jump cut.
export default function SplashScreen() {
  return (
    <div style={{
      minHeight: '100%',
      background: `linear-gradient(160deg, ${COLORS.brandNavy} 0%, ${COLORS.brandNavyMid} 60%, ${COLORS.brandNavyLight} 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ textAlign: 'center', position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0, margin: 'auto', width: '90px', height: '90px',
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,0.55) 0%, rgba(37,99,235,0) 70%)',
          animation: 'splashGlow 2.4s ease-in-out infinite',
        }} />
        <img
          src={logo} alt="GBCH Logo"
          style={{ height: '56px', width: 'auto', marginBottom: '14px', position: 'relative', animation: 'splashFadeInUp 0.7s ease-out both' }}
        />
        <h1 style={{
          fontSize: '32px', fontWeight: 800, color: COLORS.white, margin: '0 0 6px 0',
          letterSpacing: '-0.03em', lineHeight: 1, animation: 'splashFadeInUp 0.7s ease-out 0.15s both',
        }}>
          PMMS
        </h1>
        <p style={{
          fontSize: '13px', color: 'rgba(255,255,255,0.4)', margin: '0 0 22px 0', fontWeight: 500,
          animation: 'splashFadeInUp 0.7s ease-out 0.3s both',
        }}>
          Property Maintenance Management System
        </p>
        <div style={{ width: '140px', height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '999px', overflow: 'hidden', margin: '0 auto' }}>
          <div style={{
            height: '100%', background: `linear-gradient(90deg, ${COLORS.blue600}, ${COLORS.blue400})`, borderRadius: '999px',
            animation: 'splashBarFill 1.3s ease-out 0.4s both',
          }} />
        </div>
      </div>
    </div>
  )
}
