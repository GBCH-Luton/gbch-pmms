import { COLORS } from '../../lib/colors'
import { NewReportForm } from '../SubmitterDashboard'

// Temporary nav item for the Housekeeping Manager (2026-08-25): she needs
// to occasionally raise tickets outside Housekeeping's own categories
// (e.g. Maintenance), which the normal "Log a Ticket" page can't do --
// AdminRaiseTicket.jsx scopes its category list to the raiser's own
// division (fetchMaintenanceCategories(profile.division)). Rather than
// building a second full raise-ticket form, this reuses the exact same
// simple flow Ticket Submitters already use (NewReportForm shows every
// category, unscoped) -- see [[project_housekeeping_manager_temp_raise_access]]
// for the matching RLS policies this also needed, and how to remove all
// of it once the temporary need ends.
export default function AdminRaiseMaintenanceTicket({ profile }) {
  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Raise a Ticket (Any Category)</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>
        Temporary — lets you raise a ticket in any category, not just Housekeeping's own.
      </p>
      <NewReportForm profile={profile} />
    </div>
  )
}
