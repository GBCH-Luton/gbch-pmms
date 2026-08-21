import PropertyOnboardingWalk from './PropertyOnboardingWalk'
import PropertyOnboardingReview from './PropertyOnboardingReview'

// Entry point for both roles this feature is for -- see visibleTo on this
// nav item in AdminDashboard.jsx (the shell). Landlord Liaison always gets
// her review queue; anyone else who can reach this page (an Assistant
// Manager, per that same visibleTo check) gets the walk flow.
export default function AdminOnboardProperty({ profile, onNavigate, returnTo }) {
  return profile.division === 'Landlord Liaison'
    ? <PropertyOnboardingReview profile={profile} onNavigate={onNavigate} returnTo={returnTo} />
    : <PropertyOnboardingWalk profile={profile} onNavigate={onNavigate} />
}
