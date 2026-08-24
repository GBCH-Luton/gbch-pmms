-- Moves AUTO_ASSIGN_ON_RAISE_ENABLED from a hardcoded JS constant
-- (admin/shared.jsx) into pmms.settings, read fresh at submit-time instead
-- of baked into whatever JS a tab happened to load. Found live 2026-08-24
-- (ticket #414): a Submitter's tab, still authenticated but running old
-- code from before this flag existed, silently auto-assigned a ticket
-- management had explicitly asked to land Pending for manual assignment.
-- A hardcoded constant only reflects whatever was true when that tab's
-- bundle was last fetched; a long-open tab that never does a fresh
-- navigation never picks up a later change no matter how many times the
-- flag gets flipped in the repo. Reading it from the database at the
-- moment of raising closes that gap for good.
--
-- Value: false, matching the current desired state (tickets raised by
-- Ticket Submitter / Landlord Liaison land Pending for manual assignment).
-- To re-enable silent auto-assign later, update this row's setting_value
-- to `true` -- no rebuild/redeploy needed, and it takes effect immediately
-- for every tab, not just freshly-loaded ones.

insert into pmms.settings (setting_key, setting_value)
values ('auto_assign_on_raise_enabled', 'false'::jsonb)
on conflict (setting_key) do nothing;
