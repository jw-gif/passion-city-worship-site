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

  window.PCCEnv = { isStaging: () => isStaging };
})();
