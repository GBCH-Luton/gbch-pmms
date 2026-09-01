-- Directors asked to track utility bills (Gas/Electricity/Water/Council Tax/
-- Wifi) for properties GBCH pays for -- self-contained units are the
-- Service User's own responsibility, so nothing to record there. Two parts:
--
-- 1. occupancy_type on pmms.properties -- 'Self Contained' | 'Shared',
--    same plain-text-column convention as property_type/tenure_type. Drives
--    whether the new Utility Bills tab shows a live form or a read-only
--    "SU responsible" banner.
--
-- 2. pmms.property_bills -- one row per bill/invoice (a ledger, not a
--    single overwritten "current amount" field, so history is just "the
--    list of rows for this property"). Field set matches the old
--    Microsoft-Forms "Upload Invoice" form the directors used to use
--    (invoice date / start+end period / debt+credit amount / payment
--    method), plus due_date + paid_date for the new tab's own
--    Paid/Overdue/Due Soon status pill.

alter table pmms.properties
  add column if not exists occupancy_type text not null default 'Shared';

create table if not exists pmms.property_bills (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references pmms.properties(id) on delete cascade,
  bill_type text not null, -- Gas / Electricity / Water / Council Tax / Wifi / Other
  invoice_date date,
  invoice_start_date date,
  invoice_end_date date,
  due_date date,
  paid_date date,
  debt_amount numeric,
  credit_amount numeric, -- set instead of debt_amount for a refund/overpayment entry
  payment_method text, -- Direct Debit / Card / Key / PAYG
  invoice_file_url text,
  notes text,
  recorded_by uuid references public.staff(id),
  recorded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pmms.property_bills enable row level security;

-- Same single-policy shape as property_status_history/property_room_history
-- -- admin/manager full access. The Utility Bills tab is already kept out
-- of Housekeeping's and Compliance's tab lists client-side (see
-- DIVISION_PROFILE_TABS in AdminProperties.jsx); a real per-division RLS
-- restriction is the same parked follow-up noted there, not redone here.
create policy "admin_manager_full_access" on pmms.property_bills
  for all to authenticated
  using (pmms.is_admin_or_manager())
  with check (pmms.is_admin_or_manager());

notify pgrst, 'reload schema';
