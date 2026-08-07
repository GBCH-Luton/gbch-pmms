-- Removes the two "Test Builder" / "Test Builder 2" fixture accounts.
-- Verified via a full cross-schema UUID/text sweep (public, pmms,
-- inventory, it_luton, training) that neither staff.id nor their auth
-- user_id is referenced anywhere outside public.staff itself and Supabase's
-- own auth.sessions/auth.identities bookkeeping -- safe to remove.
--
-- NOT included here: Priya Nair / James Okafor / Sarah Mitchell (also
-- @example.com dummy accounts) -- the same sweep found they're actively
-- referenced by training.training_permissions (role 'sw'), so deleting
-- them needs a separate decision, not a blanket delete.

delete from public.staff where email in ('builder@gbch.test', 'builder2@gbch.test');
delete from auth.users where email in ('builder@gbch.test', 'builder2@gbch.test');
