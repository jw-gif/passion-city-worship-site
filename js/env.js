/* =============================================
   Which site is this?

   The same code is served from two places — the live site built from `main`,
   and a staging site built from the `staging` branch — and they share one
   Supabase project. So a preview build says so plainly, and each site offers
   a link across to the other.
   ============================================= */
(function () {
  'use strict';

  const config = window.PCC || {};
  const host = location.hostname.toLowerCase();

  /* Who has to sign in, and where.

     Pages are open to anyone holding the link — the handbook at /, and each
     copy at its own address. That is what the links are for. The index at
     /home is the exception: a list of every version, which is a staff view of
     the place rather than something to hand out. */
  function requiresSignIn() {
    const path = location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
    return path === 'home';
  }

  /* The markup ships locked so a gated page cannot flash its contents before
     the session is known. On an open page that comes straight back off. */
  if (!requiresSignIn() || (window.PCCApi && window.PCCApi.isSignedIn())) {
    document.body.classList.remove('is-locked');
  }

  const hostOf = url => {
    if (!url) return '';
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  };

  /* Vercel serves a branch as "<project>-git-<branch>-<scope>.vercel.app", so
     staging identifies itself even before anyone fills the URLs in above. A
     custom staging.<domain> is recognised too. */
  const looksLikeAPreview = /-git-staging[-.]/.test(host) || host.startsWith('staging.');

  const isStaging =
    host === hostOf(config.STAGING_URL) ||
    (host !== hostOf(config.PRODUCTION_URL) && looksLikeAPreview);

  function apply() {
    document.body.classList.toggle('is-staging', isStaging);

    // The index of every version is a staff tool, not a visitor's business.
    const pagesLink = document.getElementById('pagesLink');
    if (pagesLink) pagesLink.hidden = !(window.PCCApi && window.PCCApi.isSignedIn());

    const link = document.getElementById('envLink');
    if (!link) return;

    const target = isStaging ? config.PRODUCTION_URL : config.STAGING_URL;
    // Anyone who lands on staging should be able to get back to the real site;
    // the trip out to staging is only offered to staff who are signed in.
    const offer = isStaging || (window.PCCApi && window.PCCApi.isSignedIn());

    link.hidden = !(target && offer);
    if (link.hidden) return;
    link.href = target;
    link.textContent = isStaging ? 'View the live site →' : 'Open staging preview →';
  }

  if (isStaging && !/^\[Staging]/.test(document.title)) {
    // Distinguishes the two in a row of browser tabs.
    document.title = `[Staging] ${document.title}`;
  }

  document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('pcc:auth', apply);

  window.PCCEnv = { isStaging: () => isStaging, requiresSignIn };
})();
