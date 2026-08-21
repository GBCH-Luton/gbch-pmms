import { supabase } from '../../lib/supabase'
import { uploadTicketAttachments } from '../../lib/ticketAttachments'
import { calculatePriorityScore, fetchMaintenanceCategories } from '../../lib/maintenanceCategories'
import { ONBOARDING_CATEGORY } from '../../lib/onboarding'
import { postSystemComment, postAuditEvent, fetchAssignableStaffForCategory, suggestAutoAssignBuilder, AUTO_ASSIGN_ON_RAISE_ENABLED } from './shared'

// Lives here (not lib/onboarding.js) because it depends on this file's own
// shared.jsx helpers -- lib/ files don't reach back into pages/admin/
// anywhere else in this codebase, so this keeps that layering intact.
//
// Raises a real ticket exactly the way AdminRaiseTicket.jsx's compliance
// walkround loop does (one failed item -> one ticket), then attaches
// media, narrates itself with the same system comment/audit event every
// other creation path leaves, and records the verdict alongside it. Used
// for every ticket this feature creates (a failed checklist item, a
// landlord-agreed extra, a Landlord Liaison flag/missed-item) -- only
// `room`/`itemKey`/`source`/`issueTag`/`description` vary per caller.
export async function raiseOnboardingTicket({ profile, walkId, propertyId, room, itemKey, source, issueTag, description, files, highVulnerability }) {
  const categories = await fetchMaintenanceCategories()
  const score = calculatePriorityScore(categories, ONBOARDING_CATEGORY, issueTag) + (highVulnerability ? 30 : 0)
  const staff = await fetchAssignableStaffForCategory(ONBOARDING_CATEGORY, {})
  const suggested = AUTO_ASSIGN_ON_RAISE_ENABLED ? await suggestAutoAssignBuilder(ONBOARDING_CATEGORY, { candidates: staff }) : null
  const resolvedBuilderId = suggested?.id || null

  const { data, error } = await supabase
    .schema('pmms')
    .from('tickets')
    .insert({
      property_id: propertyId,
      room: room || 'Whole Property (Onboarding)',
      category: ONBOARDING_CATEGORY,
      issue_tag: issueTag,
      description,
      priority_score: score,
      assigned_builder_id: resolvedBuilderId,
      assign_type: resolvedBuilderId ? 'Auto' : 'Manual',
      status: resolvedBuilderId ? 'Assigned' : 'Pending',
      first_assigned_at: resolvedBuilderId ? new Date().toISOString() : null,
      raised_by: profile.id,
      raised_by_name: profile.name,
      created_at: new Date().toISOString(),
      status_changed_at: new Date().toISOString(),
    })
    .select('id, ticket_number')

  if (error) throw new Error(error.message)
  const ticketId = data[0].id

  if (files?.length) {
    await uploadTicketAttachments(files, ticketId, profile.id, { attachmentStage: 'reported' })
  }
  await postSystemComment(ticketId, profile, `Raised from a Property Onboarding walk${room ? ` — ${room}` : ''}: ${issueTag}`)
  await postAuditEvent(ticketId, profile, 'Created', 'Raised from Property Onboarding walk')
  if (!resolvedBuilderId) {
    await postSystemComment(ticketId, profile, 'No eligible builder was found for this category at the time this ticket was raised. Needs manual assignment.')
  }

  const { error: checkError } = await supabase
    .schema('pmms')
    .from('property_onboarding_checks')
    .insert({ walk_id: walkId, room: room || null, item_key: itemKey || null, verdict: 'fail', source, ticket_id: ticketId, raised_by_name: profile.name })
  if (checkError) throw new Error(checkError.message)

  return data[0]
}
