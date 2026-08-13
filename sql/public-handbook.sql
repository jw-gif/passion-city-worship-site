-- =============================================
-- Pages are open by link; the list of them is not
--
-- Run this once in the Supabase SQL editor. It is safe to run more than once,
-- and safe whether or not any earlier access file was ever run.
--
--   /            the handbook — anyone with the link can read it.
--   /<slug>      a copy — likewise: the link is the whole ticket.
--   /home        the index of every version — signed-in staff only.
--
-- Which is why a copy is not simply readable from the `pages` table. Table
-- reads can be listed: `select slug, title from pages` would hand anyone the
-- index that /home is behind a sign-in to protect. So anonymous readers get a
-- page through page_by_slug() — you can fetch a copy you know the address of,
-- and you cannot ask what addresses exist.
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

-- ── The copies: readable one at a time, listable only by staff ──────────────
create policy "listable when signed in" on public.pages
  for select to authenticated using (true);

revoke all on public.pages from anon;
grant select on public.pages to authenticated;

/* One page, by the address someone was given. Security definer, so it reads
   past the policy above — this is the door a shared link opens. It returns
   nothing but the page asked for, so it cannot be used to enumerate them. */
create or replace function public.page_by_slug(page_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('slug', slug, 'title', title, 'content', content)
    from public.pages
   where slug = page_slug;
$$;

grant execute on function public.page_by_slug(text) to anon, authenticated;

-- Nothing is writable directly by anyone. With RLS on and no insert/update/
-- delete policy, those are refused; these revokes say the same underneath.
revoke insert, update, delete on public.sections from anon, authenticated;
revoke insert, update, delete on public.blocks   from anon, authenticated;
revoke insert, update, delete on public.staff    from anon, authenticated;
revoke insert, update, delete on public.pages    from anon, authenticated;

-- ── Worth knowing ───────────────────────────────────────────────────────────
--
-- The handbook holds staff email addresses and compensation details, and it
-- and every copy are readable by anyone who has the link. robots.txt, the
-- noindex meta tag and the X-Robots-Tag header keep them out of search
-- results, so they are unlisted rather than secret — which is what the
-- handbook was designed to be, and what a shared copy has to be to be worth
-- sharing.
--
-- A short slug can be guessed, the same way any unlisted link can. If some
-- copy ever needs to be genuinely private, give the row a flag and have
-- page_by_slug refuse it unless public.is_editor().
