-- =============================================
-- Sign-in required to read anything
--
-- Run this once in the Supabase SQL editor, after sql/multi-page.sql.
--
-- The sign-in form on the site is a door, not a lock: the publishable key in
-- js/config.js is public by design, so until these policies change, anyone can
-- read every table straight from the REST endpoint whatever the page draws.
-- This is the part that actually makes the handbook private.
--
-- The cost: everyone who needs to read the handbook now needs an account, or
-- has to be given the shared staff login. Storage is separate — see the note
-- at the bottom.
-- =============================================

-- Drop whatever read policies exist today, by whatever name they were given.
-- Writes are not affected: they never went through a policy, they go through
-- save_site / save_page, which run as security definer.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('sections', 'blocks', 'staff', 'pages')
       and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy %I on %I.%I',
                   policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;

alter table public.sections enable row level security;
alter table public.blocks   enable row level security;
alter table public.staff    enable row level security;
alter table public.pages    enable row level security;

create policy "readable when signed in" on public.sections
  for select to authenticated using (true);
create policy "readable when signed in" on public.blocks
  for select to authenticated using (true);
create policy "readable when signed in" on public.staff
  for select to authenticated using (true);
create policy "readable when signed in" on public.pages
  for select to authenticated using (true);

-- Nothing is writable directly, by anyone, on any of them. With RLS on and no
-- policy for insert/update/delete, those are refused already; this is the
-- table grant underneath saying the same thing.
revoke all on public.sections from anon, authenticated;
revoke all on public.blocks   from anon, authenticated;
revoke all on public.staff    from anon, authenticated;
revoke all on public.pages    from anon, authenticated;

grant select on public.sections to authenticated;
grant select on public.blocks   to authenticated;
grant select on public.staff    to authenticated;
grant select on public.pages    to authenticated;

-- ── Still public after this ─────────────────────────────────────────────────
--
-- Staff photos. They live in the `staff-photos` Storage bucket, which is
-- public: anyone holding a photo's URL can open it, and those URLs are in the
-- content that now requires a sign-in to read. Closing that means making the
-- bucket private and having the page ask for a signed URL per photo, which is
-- a change to how photos are loaded rather than a policy change. Left as is —
-- a photo without a name attached is a smaller exposure than the handbook.
