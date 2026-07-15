-- Renames the property status vocabulary to match the real onboarding
-- workflow: a property arrives and is "Procured" (checks/onboarding in
-- progress), then goes "Live" once ready to rent to service users.
-- "Under Repair" is retired entirely (folded into "Procured" -- a
-- property under repair isn't ready to rent either). Occupied/Void are
-- untouched.

update pmms.properties set status = 'Procured' where status = 'Active';
update pmms.properties set status = 'Live' where status = 'Inactive';
update pmms.properties set status = 'Procured' where status = 'Under Repair';

alter table pmms.properties alter column status set default 'Procured';
