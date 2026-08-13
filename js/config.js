/* =============================================
   Site configuration

   The Supabase URL and publishable key are meant to be public — they
   identify the project, they are not secrets. All write access is gated
   by row level security plus the public.editors allowlist, so an
   anonymous visitor holding this key can only read.
   ============================================= */
window.PCC = {
  SUPABASE_URL: 'https://eeubffrtcuhpqsmlubnu.supabase.co',
  SUPABASE_KEY: 'sb_publishable_f-FWzLb8Gr9CpK1bb-pxkw_0dqhPqaP',

  /* Committed point-in-time copy of the content, used only when the live
     database can't be reached (see tools/snapshot.mjs). */
  FALLBACK_URL: 'content/fallback.json',

  /* ── The two places this site runs ──
     Production is the `main` branch; staging is the `staging` branch, which
     Vercel builds at its own URL. Paste both URLs here and each site links to
     the other from the sidebar; leave one blank and that link stays hidden.
     Staging recognises itself on Vercel's branch URLs either way, so it is
     always badged as a preview.

     Both talk to the same Supabase project, so the content is shared: staging
     previews code changes, not content changes. Saving an edit there changes
     the real handbook. */
  PRODUCTION_URL: 'https://passion-city-worship-site.vercel.app',
  STAGING_URL: '',
};
