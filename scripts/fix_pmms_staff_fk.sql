-- Repoints pmms.comments.author_id and pmms.work_sessions.builder_id to
-- reference public.staff(id) instead of the near-empty pmms.staff(id).
--
-- Root cause: profile.id throughout the app (BuilderDashboard, AdminDashboard,
-- App.jsx fetchProfile) comes from public.staff, but these two FKs were created
-- against pmms.staff, a separate table that only contains one test row. That's
-- why "comments_author_id_fkey" violations happen for every real builder.
--
-- pmms.tickets.assigned_builder_id has no FK at all, so it already works with
-- public.staff ids today without needing any change here.

alter table pmms.comments
  drop constraint if exists comments_author_id_fkey;

alter table pmms.comments
  add constraint comments_author_id_fkey
  foreign key (author_id) references public.staff (id);

alter table pmms.work_sessions
  drop constraint if exists work_sessions_builder_id_fkey;

alter table pmms.work_sessions
  add constraint work_sessions_builder_id_fkey
  foreign key (builder_id) references public.staff (id);
