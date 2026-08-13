-- =============================================
-- Extra pages, each at its own URL slug
--
-- Run this once in the Supabase SQL editor. It is additive and idempotent:
-- nothing here touches `sections`, `blocks`, `staff`, or `save_site`, so the
-- handbook at / keeps working exactly as it does now, migration or no.
--
-- The handbook lives in those normalised tables. A copy of it lives here, as
-- one row holding the same payload shape the editor already saves and the
-- renderer already draws — so duplicating a page is a copy of one JSONB value,
-- and no schema has to be reshaped to make room for a second page.
-- =============================================

create table if not exists public.pages (
  slug        text primary key
              -- lowercase, digits and dashes: what can sit in a URL unescaped
              check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
                     and slug not in ('home', 'index', 'js', 'static', 'content', 'sql')),
  title       text not null default 'Untitled page',
  content     jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.pages is
  'Alternate versions of the handbook, one row per URL slug. content holds {sections, staff} exactly as save_site accepts it.';

alter table public.pages enable row level security;

-- Anyone with the link can read a page — that is the point of sharing one.
drop policy if exists "pages are readable by anyone" on public.pages;
create policy "pages are readable by anyone"
  on public.pages for select
  using (true);

-- No direct writes from any client, ever. Everything goes through the
-- functions below, which check the editors allowlist first.
drop policy if exists "pages are written only through functions" on public.pages;
create policy "pages are written only through functions"
  on public.pages for all
  using (false)
  with check (false);

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.editors where user_id = auth.uid());
$$;

/* The handbook as one payload, read out of the normalised tables. This is what
   a new page is duplicated from when no source is named. */
create or replace function public.handbook_content()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sections', coalesce((
      select jsonb_agg(section order by section->>'position')
      from (
        select jsonb_build_object(
          'id', s.id,
          'kind', s.kind,
          'eyebrow', s.eyebrow,
          'title', s.title,
          'nav_label', s.nav_label,
          'description', s.description,
          'is_builtin', s.is_builtin,
          'position', s.position,
          'blocks', coalesce((
            select jsonb_agg(jsonb_build_object('label', b.label, 'body_html', b.body_html)
                             order by b.position)
            from public.blocks b
            where b.section_id = s.id
          ), '[]'::jsonb)
        ) as section
        from public.sections s
      ) rows
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', st.name, 'role', st.role,
               'email', st.email, 'photo_url', st.photo_url) order by st.position)
      from public.staff st
    ), '[]'::jsonb)
  );
$$;

-- ── Writes ──────────────────────────────────────────────────────────────────

/* Save an existing page. Mirrors save_site: editors only, and it refuses a
   payload with no sections so a client-side bug cannot blank a page. */
create or replace function public.save_page(page_slug text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_editor() then
    raise exception 'Only an allowlisted editor can save changes.';
  end if;
  if coalesce(jsonb_array_length(payload->'sections'), 0) = 0 then
    raise exception 'A page needs at least one section.';
  end if;
  if not exists (select 1 from public.pages where slug = page_slug) then
    raise exception 'No page at that address: %', page_slug;
  end if;

  update public.pages
     set content = payload,
         title = coalesce(nullif(payload->>'title', ''), title),
         updated_at = now()
   where slug = page_slug;
end;
$$;

/* Make a new page. With no source it copies the handbook at /; name a source
   slug to copy one of the other pages instead. */
create or replace function public.create_page(
  page_slug text,
  page_title text default 'Untitled page',
  copy_from text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_content jsonb;
begin
  if not public.is_editor() then
    raise exception 'Only an allowlisted editor can add a page.';
  end if;
  if exists (select 1 from public.pages where slug = page_slug) then
    raise exception 'There is already a page at /%', page_slug;
  end if;

  if copy_from is null then
    source_content := public.handbook_content();
  else
    select content into source_content from public.pages where slug = copy_from;
    if source_content is null then
      raise exception 'Nothing to copy at /%', copy_from;
    end if;
  end if;

  insert into public.pages (slug, title, content)
  values (page_slug, coalesce(nullif(page_title, ''), 'Untitled page'), source_content);

  return jsonb_build_object('slug', page_slug, 'title', page_title);
end;
$$;

/* Change a page's address and/or its name. */
create or replace function public.rename_page(
  page_slug text,
  new_slug text default null,
  new_title text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_editor() then
    raise exception 'Only an allowlisted editor can rename a page.';
  end if;
  if new_slug is not null and new_slug <> page_slug
     and exists (select 1 from public.pages where slug = new_slug) then
    raise exception 'There is already a page at /%', new_slug;
  end if;

  update public.pages
     set slug = coalesce(nullif(new_slug, ''), slug),
         title = coalesce(nullif(new_title, ''), title),
         updated_at = now()
   where slug = page_slug;
end;
$$;

create or replace function public.delete_page(page_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_editor() then
    raise exception 'Only an allowlisted editor can remove a page.';
  end if;
  delete from public.pages where slug = page_slug;
end;
$$;

-- Anonymous visitors read; only signed-in users may even attempt a write, and
-- the functions themselves insist on the editors allowlist.
revoke all on function public.save_page(text, jsonb) from public, anon;
revoke all on function public.create_page(text, text, text) from public, anon;
revoke all on function public.rename_page(text, text, text) from public, anon;
revoke all on function public.delete_page(text) from public, anon;
revoke all on function public.handbook_content() from public, anon;

grant execute on function public.save_page(text, jsonb) to authenticated;
grant execute on function public.create_page(text, text, text) to authenticated;
grant execute on function public.rename_page(text, text, text) to authenticated;
grant execute on function public.delete_page(text) to authenticated;
grant execute on function public.handbook_content() to authenticated;
grant execute on function public.is_editor() to authenticated;
