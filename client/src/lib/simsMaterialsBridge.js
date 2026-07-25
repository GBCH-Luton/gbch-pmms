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

// Contract: return every Maintenance-division item from SIMS's catalog,
// with the same fields SIMS's own item table shows (category, status, the
// new/used/in-use breakdown, unit price, min stock threshold) so PMMS's
// Stock page can mirror it exactly, not just a stripped-down picker list.
// A real implementation would call something like:
//   supabase.schema('sims').rpc('list_maintenance_items_for_pmms')
// No extra auth beyond the caller's normal PMMS session should be
// required -- the RPC itself needs to be SECURITY DEFINER to read
// sims.items/sims.categories despite the caller having no
// sims.staff_roles row.
//
// `total_quantity` = quantity_new + quantity_used + quantity_in_use
// (matches what SIMS's own table totals).
// `available_quantity` = quantity_new + quantity_used (excludes whatever's
// currently checked out/in use) -- this is the number the builder
// materials picker uses, since something already in use isn't free for a
// new job.
// `low_stock` = total_quantity < min_stock_threshold (false whenever
// min_stock_threshold is null, i.e. not tracked for that item).
export async function fetchAvailableMaterials() {
  // STUB -- this is a static snapshot of sims.items (division='Maintenance')
  // joined to sims.categories, pulled directly from the real SIMS sandbox
  // data on 2026-07-22 so the prototype reflects the real catalog instead
  // of invented placeholder items. Real ids preserved as-is. Still not a
  // live query -- won't reflect stock changes made in SIMS after this
  // snapshot was taken, which is exactly what the real bridge function
  // needs to fix.
  await new Promise(resolve => setTimeout(resolve, 150))
  const raw = [
    { id: '55c43d4e-ab18-43e9-8431-fb12c4d82388', name: 'testing for link', category: 'Cable & Wiring', status: 'New', unit: 'litre', unit_price: 12, quantity_new: 3, quantity_used: 0, quantity_in_use: 0, min_stock_threshold: 1 },
    { id: '84931076-ec7b-40b5-bc8d-c8ef689dc75c', name: '15mm Compression Elbow', category: 'Plumbing Parts', status: 'New', unit: 'each', unit_price: 1.2, quantity_new: 45, quantity_used: 0, quantity_in_use: 0, min_stock_threshold: 20 },
    { id: '03bead81-c899-42b2-a747-7fc5135c7879', name: '15mm Copper Pipe', category: 'Pipe & Fittings', status: 'New', unit: 'metre', unit_price: 3.4, quantity_new: 8, quantity_used: 0, quantity_in_use: 0, min_stock_threshold: 15 },
    { id: '6ef27ad6-2521-4212-a290-53aee30667f8', name: '50mm Wood Screws', category: 'Fixings & Fasteners', status: 'New', unit: 'box', unit_price: 4.5, quantity_new: 34, quantity_used: 0, quantity_in_use: 0, min_stock_threshold: 5 },
    { id: '2f114fa7-ab65-429e-980f-61d2c241851f', name: 'Brilliant White Emulsion', category: 'Paint & Decorating', status: 'New', unit: 'litre', unit_price: 14.99, quantity_new: 6, quantity_used: 0, quantity_in_use: 0, min_stock_threshold: 10 },
    { id: '22f03459-5665-437b-b147-2140a085fc79', name: 'Hi-Vis Vest', category: 'PPE & Safety', status: 'New', unit: 'each', unit_price: 3.99, quantity_new: 25, quantity_used: 0, quantity_in_use: 0, min_stock_threshold: 10 },
    { id: 'c3e14337-39a9-4514-afbf-8d7039f1662f', name: 'SDS Drill (Depreciation Demo)', category: 'Tools & Equipment', status: 'In Use', unit: 'each', unit_price: 260, quantity_new: 0, quantity_used: 0, quantity_in_use: 1, min_stock_threshold: null },
  ]

  return raw.map(item => {
    const total_quantity = item.quantity_new + item.quantity_used + item.quantity_in_use
    return {
      ...item,
      total_quantity,
      available_quantity: item.quantity_new + item.quantity_used,
      low_stock: item.min_stock_threshold != null && total_quantity < item.min_stock_threshold,
    }
  })
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
