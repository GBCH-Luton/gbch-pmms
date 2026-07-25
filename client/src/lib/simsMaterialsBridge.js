// STUB / PROTOTYPE -- sandbox-only experiment linking PMMS to SIMS (a
// companion stock/inventory app, same Supabase project, its own `sims`
// schema). Not production-bound, not required for either system's launch.
//
// These two functions are the exact seam where a real SIMS-side bridge
// needs to slot in. A PMMS builder has no row in sims.staff_roles --
// they're two independent identity grants over the same shared
// public.staff table, not one shared permission set -- so under SIMS's
// own RLS a plain PMMS session can't read sims.items or write to
// sims.job_material_usage directly. The real bridge is almost certainly a
// SECURITY DEFINER function living in the sims schema (the same pattern
// this project already uses for complete_garden_ticket_property_update),
// built from a SIMS session, not from here.

// Contract: return every enabled Maintenance-division item from SIMS's
// catalog, shaped for a simple item + quantity picker. A real
// implementation would call something like:
//   supabase.schema('sims').rpc('list_maintenance_items_for_pmms')
// No extra auth beyond the caller's normal PMMS session should be
// required -- the RPC itself needs to be SECURITY DEFINER to read
// sims.items despite the caller having no sims.staff_roles row.
export async function fetchAvailableMaterials() {
  // STUB -- mock data standing in for the real SIMS catalog.
  await new Promise(resolve => setTimeout(resolve, 150))
  return [
    { id: 'stub-1', name: 'Radiator valve (15mm)', unit: 'each', available_quantity: 42 },
    { id: 'stub-2', name: 'Copper pipe (15mm, 3m length)', unit: 'length', available_quantity: 18 },
    { id: 'stub-3', name: 'PTFE tape', unit: 'roll', available_quantity: 120 },
    { id: 'stub-4', name: 'Silicone sealant (white)', unit: 'tube', available_quantity: 30 },
    { id: 'stub-5', name: 'Consumer unit MCB (32A)', unit: 'each', available_quantity: 9 },
  ]
}

// Contract: log that `quantity` of `itemId` was used against PMMS ticket
// `ticketId`, by PMMS staff member `staffId`. A real implementation would
// call something like:
//   supabase.schema('sims').rpc('log_job_material_usage_from_pmms', {
//     p_pmms_ticket_id: ticketId, p_item_id: itemId, p_quantity: quantity, p_staff_id: staffId,
//   })
// which should itself verify p_pmms_ticket_id actually exists in
// pmms.tickets (a plain cross-schema FK already in place on
// sims.job_material_usage.pmms_job_id per the SIMS side) before inserting,
// and should reject a non-positive quantity or an unknown item_id.
export async function logMaterialUsage(ticketId, itemId, quantity, staffId) {
  // STUB -- pretend-success, no real write anywhere yet.
  console.log('[SIMS bridge stub] would log material usage:', { ticketId, itemId, quantity, staffId })
  await new Promise(resolve => setTimeout(resolve, 150))
  return { success: true }
}
