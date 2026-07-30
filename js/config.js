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
};
