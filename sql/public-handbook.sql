-- =============================================
-- The handbook is readable by anyone; the copies are not
--
-- Run this once in the Supabase SQL editor. It supersedes
-- sql/private-content.sql, and is safe whether or not that one was ever run.
--
--   /            the handbook — anyone with the link can read it, and only an
--                allowlisted editor can change it. That is how it was before
--                the sign-in wall, and how it is again.
--   /home        the index of versions — signed-in staff only.
--   /<slug>      a copy — signed-in staff only, until you decide otherwise.
--
-- Writing is untouched by any of this: it goes through save_site / save_page,
-- which run as security definer and check the editors allowlist themselves.
-- =============================================

-- Clear whatever read policies are on these four tables now, whatever they
-- were called, so this file is the single answer to "who can read what".
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

-- ── The handbook: open ──────────────────────────────────────────────────────
create policy "readable by anyone" on public.sections for select using (true);
create policy "readable by anyone" on public.blocks   for select using (true);
create policy "readable by anyone" on public.staff    for select using (true);

grant select on public.sections to anon, authenticated;
grant select on public.blocks   to anon, authenticated;
grant select on public.staff    to anon, authenticated;

-- ── The copies: staff only ──────────────────────────────────────────────────
create policy "readable when signed in" on public.pages
  for select to authenticated using (true);

revoke all on public.pages from anon;
grant select on public.pages to authenticated;

-- Nothing is writable directly by anyone. With RLS on and no insert/update/
-- delete policy, those are refused; these revokes say the same underneath.
revoke insert, update, delete on public.sections from anon, authenticated;
revoke insert, update, delete on public.blocks   from anon, authenticated;
revoke insert, update, delete on public.staff    from anon, authenticated;
revoke insert, update, delete on public.pages    from anon, authenticated;

-- ── Worth knowing ───────────────────────────────────────────────────────────
--
-- The handbook holds staff email addresses and compensation details, and is
-- readable by anyone who has the link. robots.txt, the noindex meta tag and
-- the X-Robots-Tag header keep it out of search results, so it is unlisted
-- rather than secret — which is what it was designed to be.
--
-- To share a copy the same way, its row would need a flag of its own and a
-- policy like: using (is_public or auth.role() = 'authenticated').
