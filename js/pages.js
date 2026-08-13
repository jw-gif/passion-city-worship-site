/* =============================================
   The page index

   Lists the handbook and every copy of it, and makes new ones. A copy is a
   duplicate of an existing page's content under a new URL slug — same
   template, same editing, its own address to share.

   Only signed-in staff see the list: the individual pages are shareable by
   link, but a directory of every draft is not something to leave in the open.
   ============================================= */
(function () {
  'use strict';

  const api = window.PCCApi;

  const gate = document.getElementById('pagesGate');
  const panel = document.getElementById('pagesPanel');
  const list = document.getElementById('pagesList');
  const empty = document.getElementById('pagesEmpty');
  const errorBox = document.getElementById('pagesError');
  const hint = document.getElementById('pagesHint');

  /* A slug has to survive being pasted into a URL and read aloud. */
  const SLUG_RULE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const RESERVED = ['home', 'index', 'js', 'static', 'content', 'sql'];

  const slugify = text =>
    (text || '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);

  function slugProblem(slug) {
    if (!slug) return 'An address is needed.';
    if (!SLUG_RULE.test(slug)) {
      return 'Use lowercase letters, numbers and dashes — for example team-2026.';
    }
    if (RESERVED.includes(slug)) return `"${slug}" is reserved. Try another address.`;
    return null;
  }

  function showError(message) {
    errorBox.replaceChildren();
    if (!message) {
      errorBox.hidden = true;
      return;
    }
    const title = document.createElement('h2');
    title.textContent = 'Something went wrong';
    const body = document.createElement('p');
    body.textContent = message;
    errorBox.append(title, body);
    errorBox.hidden = false;
  }

  const pageUrl = slug => `${location.origin}/${slug}`;

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ═══════════════════════════════════════════
     RENDERING
     ═══════════════════════════════════════════ */

  function row({ slug, title, updated, isHandbook }) {
    const item = document.createElement('li');
    item.className = 'page-card';
    if (isHandbook) item.classList.add('page-card--handbook');

    const main = document.createElement('div');
    main.className = 'page-card__main';

    const name = document.createElement('a');
    name.className = 'page-card__title';
    name.href = isHandbook ? '/' : `/${slug}`;
    name.textContent = title;
    main.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'page-card__meta';
    const address = document.createElement('span');
    address.className = 'page-card__slug';
    address.textContent = isHandbook ? '/' : `/${slug}`;
    meta.appendChild(address);
    if (updated) {
      const when = document.createElement('span');
      when.textContent = `Updated ${formatDate(updated)}`;
      meta.appendChild(when);
    }
    if (isHandbook) {
      const tag = document.createElement('span');
      tag.className = 'page-card__tag';
      tag.textContent = 'Original';
      meta.appendChild(tag);
    }
    main.appendChild(meta);
    item.appendChild(main);

    const actions = document.createElement('div');
    actions.className = 'page-card__actions';

    actions.appendChild(action('Copy link', () => copyLink(isHandbook ? '' : slug)));
    actions.appendChild(action('Duplicate', () => duplicate(isHandbook ? null : slug, title)));
    if (!isHandbook) {
      actions.appendChild(action('Rename', () => rename(slug, title)));
      actions.appendChild(action('Delete', () => remove(slug, title), 'page-action--danger'));
    }
    item.appendChild(actions);
    return item;
  }

  function action(label, onClick, extraClass) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `page-action${extraClass ? ` ${extraClass}` : ''}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function say(message) {
    hint.textContent = message || '';
    if (!message) return;
    clearTimeout(say._timer);
    say._timer = setTimeout(() => {
      hint.textContent = '';
    }, 4000);
  }

  async function copyLink(slug) {
    const url = slug ? pageUrl(slug) : location.origin + '/';
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied.');
    } catch {
      // Clipboard access can be refused; showing the address still helps.
      say(url);
    }
  }

  /* ═══════════════════════════════════════════
     LOADING
     ═══════════════════════════════════════════ */

  async function load() {
    if (!api.isSignedIn()) {
      gate.hidden = false;
      panel.hidden = true;
      showError('');
      return;
    }
    gate.hidden = true;
    panel.hidden = false;

    let pages;
    try {
      pages = await api.rest('pages?select=slug,title,updated_at&order=updated_at.desc');
    } catch (err) {
      panel.hidden = true;
      // The table is missing until the migration in sql/multi-page.sql is run.
      const missingTable = err.status === 404 || /relation|does not exist|schema cache/i.test(err.message || '');
      showError(
        missingTable
          ? 'Extra pages are not set up on this database yet. Run sql/multi-page.sql in the Supabase SQL editor once, then reload.'
          : err.message || 'The list of pages could not be loaded.'
      );
      return;
    }

    showError('');
    list.replaceChildren();
    list.appendChild(row({ slug: '', title: 'Worship Team Handbook', isHandbook: true }));
    (pages || []).forEach(page =>
      list.appendChild(row({ slug: page.slug, title: page.title, updated: page.updated_at }))
    );
    empty.hidden = (pages || []).length > 0;
  }

  /* ═══════════════════════════════════════════
     ACTIONS
     ═══════════════════════════════════════════ */

  async function duplicate(sourceSlug, sourceTitle) {
    const suggested = sourceTitle ? `${sourceTitle} copy` : 'New version';
    const title = prompt('Name this version — for staff, not shown on the page', suggested);
    if (title === null) return;

    const slug = prompt(
      'Address for it. It will live at ' + location.origin + '/…',
      slugify(title) || 'new-version'
    );
    if (slug === null) return;

    const wanted = slugify(slug);
    const problem = slugProblem(wanted);
    if (problem) {
      say(problem);
      return;
    }

    try {
      await api.rpc('create_page', {
        page_slug: wanted,
        page_title: title.trim() || 'Untitled page',
        copy_from: sourceSlug || null,
      });
    } catch (err) {
      say(err.message || 'That page could not be created.');
      return;
    }
    say(`Made at /${wanted}.`);
    await load();
  }

  async function rename(slug, title) {
    const nextTitle = prompt('Name for this version', title);
    if (nextTitle === null) return;
    const nextSlug = prompt('Address for it', slug);
    if (nextSlug === null) return;

    const wanted = slugify(nextSlug);
    const problem = slugProblem(wanted);
    if (problem) {
      say(problem);
      return;
    }

    try {
      await api.rpc('rename_page', {
        page_slug: slug,
        new_slug: wanted,
        new_title: nextTitle.trim(),
      });
    } catch (err) {
      say(err.message || 'That page could not be renamed.');
      return;
    }
    if (wanted !== slug) say(`Now at /${wanted} — old links to /${slug} will stop working.`);
    await load();
  }

  async function remove(slug, title) {
    if (!confirm(`Delete "${title}" at /${slug}? Anyone with that link will lose it.`)) return;
    try {
      await api.rpc('delete_page', { page_slug: slug });
    } catch (err) {
      say(err.message || 'That page could not be deleted.');
      return;
    }
    say(`Deleted /${slug}.`);
    await load();
  }

  /* ═══════════════════════════════════════════
     WIRING
     ═══════════════════════════════════════════ */

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('newPageBtn')?.addEventListener('click', () => duplicate(null, 'Handbook'));
    document.getElementById('gateSignIn')?.addEventListener('click', () => {
      document.getElementById('adminToggle')?.click();
    });
    load();
  });

  window.addEventListener('pcc:auth', load);
})();
