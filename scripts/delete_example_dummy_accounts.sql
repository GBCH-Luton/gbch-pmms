-- Removes the 3 remaining @example.com dummy staff (Priya Nair, James
-- Okafor, Sarah Mitchell), pre-dating the real staff import. Unlike
-- Test Builder/Test Builder 2, these were referenced by
-- training.training_permissions (role 'sw') -- user confirmed full
-- cross-system cleanup rather than leaving them or deferring to Training's
-- owner, so the permissions rows are removed here too, not just the staff
-- rows and their Auth logins.

delete from training.training_permissions where staff_id in (
  '0580249b-7436-4af1-9591-71c8767ed876', -- Priya Nair
  '2cc2a731-0ccb-4c97-b86d-9fcf5940fb12', -- James Okafor
  '88a17f91-c422-42d5-9755-96d8b21c765c'  -- Sarah Mitchell
);

delete from public.staff where email in ('priya@example.com', 'james@example.com', 'sarah@example.com');

delete from auth.users where email in ('priya@example.com', 'james@example.com', 'sarah@example.com');
