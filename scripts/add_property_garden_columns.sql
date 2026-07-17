-- Gardens tracking feature: per-property garden state, last-attended
-- record, and front/back photos. `has_garden` is opt-in per property,
-- same shape as the existing `high_vulnerability` boolean -- most
-- properties won't have this set until an admin turns it on via the
-- new Gardens tab (PropertyGardensTab.jsx).
--
-- `garden_last_attended_by` is free text rather than a staff_id FK
-- because attendance is a mix of internal staff and external
-- contractors, who have no `staff` row at all.
alter table pmms.properties add column if not exists has_garden boolean default false;
alter table pmms.properties add column if not exists garden_state text;
alter table pmms.properties add column if not exists garden_last_attended_date date;
alter table pmms.properties add column if not exists garden_last_attended_by text;
alter table pmms.properties add column if not exists garden_front_photo_url text;
alter table pmms.properties add column if not exists garden_back_photo_url text;
