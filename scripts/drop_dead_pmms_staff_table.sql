-- pmms.staff (distinct from the real, actively-used public.staff) was
-- locked to admin-only on 2026-07-22 after the security audit found it
-- wide open (see scripts/lock_down_dead_pmms_staff_table.sql). Confirmed
-- fully dead before dropping: no client code references it, no foreign
-- keys point to or from it, no views or functions depend on it. Its one
-- row (an old "Test Admin" seed record) is preserved in
-- backups/2026-07-22-security-audit-fixes/data/pmms.staff.json.

drop table if exists pmms.staff;
