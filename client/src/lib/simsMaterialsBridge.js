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
  // STUB -- this is a static snapshot of sims.items (division='Maintenance'),
  // pulled directly from the real SIMS sandbox data on 2026-07-22 so the
  // prototype at least reflects the real catalog instead of invented
  // placeholder items. Real ids preserved as-is. Still not a live query --
  // won't reflect stock changes made in SIMS after this snapshot was taken,
  // which is exactly what the real bridge function needs to fix.
  await new Promise(resolve => setTimeout(resolve, 150))
  return [
    { id: '55c43d4e-ab18-43e9-8431-fb12c4d82388', name: 'testing for link', unit: 'litre', available_quantity: 3 },
    { id: '84931076-ec7b-40b5-bc8d-c8ef689dc75c', name: '15mm Compression Elbow', unit: 'each', available_quantity: 45 },
    { id: '03bead81-c899-42b2-a747-7fc5135c7879', name: '15mm Copper Pipe', unit: 'metre', available_quantity: 8 },
    { id: '6ef27ad6-2521-4212-a290-53aee30667f8', name: '50mm Wood Screws', unit: 'box', available_quantity: 34 },
    { id: '2f114fa7-ab65-429e-980f-61d2c241851f', name: 'Brilliant White Emulsion', unit: 'litre', available_quantity: 6 },
    { id: '22f03459-5665-437b-b147-2140a085fc79', name: 'Hi-Vis Vest', unit: 'each', available_quantity: 25 },
    { id: 'c3e14337-39a9-4514-afbf-8d7039f1662f', name: 'SDS Drill (Depreciation Demo)', unit: 'each', available_quantity: 0 },
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
