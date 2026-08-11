# Passion City Worship Team handbook

The onboarding handbook for the Passion City Church worship team. Worship staff
sign in on the site itself and edit it in place — no code, no deploys, no
markdown.

- **Site:** a single static page (`index.html`) plus vanilla JS. No build step,
  no bundler, no npm dependencies at runtime.
- **Content + logins:** Supabase (Postgres, Auth, and Storage for staff photos).
- **Hosting:** Vercel (any static host works — nothing is server-rendered).

---

## Editing the site

1. Open the site and click **Staff login** at the bottom of the left sidebar.
2. Sign in with the shared worship staff account. (The email is
   `worship@passioncitychurch.com`; the password is kept out of this repo —
   ask whoever set it up.)
3. An **Edit** button appears in the bottom-right corner. Click it.
4. Change anything on the page:
   - Click any text to type over it. Selecting text in a content block pops up
     a small toolbar for bold, italic, headings, and lists.
   - `Enter` in a heading, name, role, or description breaks the line there.
     (Addresses, sidebar labels, and block labels stay on one line.)
   - **Add block** / the small **×** on a block adds and removes content cards.
   - **Add new section** / **Remove section** adds and removes whole sections,
     including their sidebar links.
   - Sidebar link names are editable directly in the sidebar.
   - On the staff directory: click a photo to replace it, edit names, roles and
     emails in place, use **Add staff member**, or the **×** to remove someone.
   - **To reorder anything, drag it by its grip** (the ⠿ dots):
     - *People* — the grip at the top of a staff card.
     - *Blocks* — the grip above a block's label.
     - *Sections* — the grip on a sidebar link. Sorting the sidebar sorts the
       page; a link and its section always move together.

     Keyboard: tab to a grip and use the arrow keys, or `Home` / `End`. `Esc`
     mid-drag puts the item back.
5. Click **Save changes**. Everyone sees the update immediately — there is no
   deploy step.

**Cancel** discards everything since you clicked Edit. `Esc` cancels,
`Cmd/Ctrl+S` saves.

> Saving replaces the whole page in one transaction, so two people editing at
> the same time will overwrite each other. With one shared account, edit one at
> a time.

### After changing staff photos

Uploaded photos go to Supabase Storage. Refresh the offline copy afterwards so
it stays current:

```bash
node tools/snapshot.mjs   # rewrites content/fallback.json
git commit -am "Refresh content snapshot" && git push
```

---

## First-time setup

### 1. Change the shared password

The account ships with a temporary password. Change it once, immediately:
Supabase dashboard → **Authentication** → **Users** → `worship@passioncitychurch.com`
→ **Reset password**.

### 2. Turn on leaked-password protection

Supabase dashboard → **Authentication** → **Policies** → enable
**leaked password protection**. This rejects passwords found in known
breaches. (Recommended by Supabase's own security linter.)

### 3. Deploy to Vercel

The repo is static, so there is nothing to configure and no environment
variables to set.

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. **Add New… → Project**, pick `jmw88/passion-city-worship-site`.
3. Framework preset: **Other**. Leave build command and output directory blank.
4. **Deploy.**

`vercel.json` already sets the redirects (old `*.html` URLs → the matching
section) and security headers. To use a custom domain, add it under
**Settings → Domains**.

Nothing here is Vercel-specific — Netlify, Cloudflare Pages, or GitHub Pages
would serve it equally well, though only Vercel reads `vercel.json`.

---

## Managing who can edit

Being able to sign in is **not** enough to edit; a user also has to be on the
`public.editors` allowlist. That way an accidentally-enabled public signup
can't grant anyone write access.

Give someone their own login (recommended over sharing one account):

```sql
-- After creating the user in Authentication → Users:
insert into public.editors (user_id, label)
select id, 'Jane Doe' from auth.users where email = 'jane@passioncitychurch.com';
```

Revoke access without deleting their account:

```sql
delete from public.editors
where user_id = (select id from auth.users where email = 'jane@passioncitychurch.com');
```

---

## How it fits together

```
index.html          Page shell only — the sidebar and sections are built by JS
js/config.js        Supabase project URL + publishable key (both are public)
js/sanitize.js      Strict HTML allowlist, applied on save and on render
js/supabase.js      Small REST/Auth/Storage client (no supabase-js dependency)
js/site.js          Loads content, renders the page, serializes it back for saving
js/editor.js        Edit mode, and the single save call
js/auth-ui.js       Staff sign-in dialog
content/fallback.json  Committed copy of the content, used only when offline
tools/snapshot.mjs  Regenerates the fallback copy from the database
```

### Data model

| Table      | Purpose                                                          |
| ---------- | ---------------------------------------------------------------- |
| `sections` | One row per page section, in sidebar order. `kind` is `hero`, `staff`, or `grid`. |
| `blocks`   | Content cards inside a `grid` section (and the welcome letter body). |
| `staff`    | The staff directory, in display order.                            |
| `editors`  | Allowlist of users permitted to save changes.                      |

Reads are open to everyone (`anon` can `SELECT`). Writes go exclusively through
`public.save_site(payload jsonb)`, which requires an allowlisted editor,
replaces everything in one transaction, and refuses a payload with zero
sections so a client-side bug can't blank the handbook.

### Why the site is public but unlisted

The handbook holds staff email addresses and compensation details, so
`robots.txt`, a `noindex` meta tag, and an `X-Robots-Tag` header keep it out of
search results. It is still readable by anyone with the link — that is
deliberate, so new team members can be sent straight to it. If it ever needs to
be genuinely private, the content tables would need a read policy requiring a
signed-in user, and every team member would need an account.

### If Supabase is unreachable

Free-tier Supabase projects pause after about a week with no activity, and a
paused project has to be resumed from the dashboard. If the database can't be
reached the site renders `content/fallback.json` instead and shows a small
"showing a saved offline copy" banner, so visitors always see the handbook.
Editing is disabled in that state, so a stale copy can never overwrite live
content.

Regular traffic keeps the project awake. If it pauses more than you'd like,
Supabase's paid tier removes the behaviour.
