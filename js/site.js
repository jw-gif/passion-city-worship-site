/* =============================================
   Site loading + rendering

   The whole page (sidebar links included) is built from the database so that
   added, renamed, reordered, and removed sections all survive a reload.
   If the database can't be reached we fall back to a committed snapshot
   rather than leaving the visitor staring at "Loading…".
   ============================================= */
(function () {
  'use strict';

  const { setHtml, setInline, html: cleanHtml, inline: cleanInline } = window.PCCSanitize;

  /* ═══════════════════════════════════════════
     LOADING
     ═══════════════════════════════════════════ */

  const SECTION_SELECT =
    'sections?select=id,kind,eyebrow,title,nav_label,description,is_builtin,' +
    'blocks(label,body_html,position)&order=position.asc';
  const STAFF_SELECT = 'staff?select=name,role,email,photo_url&order=position.asc';

  /** Which page the URL is asking for. "" is the handbook itself, at /. */
  function currentSlug() {
    const path = location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
    if (!path || path === 'index') return '';
    try {
      return decodeURIComponent(path).toLowerCase();
    } catch {
      return path.toLowerCase();
    }
  }

  /* The handbook lives in the sections/blocks/staff tables. Every other page is
     one row in `pages`, holding the same shape this file serializes and renders
     — so the only difference between them is where the payload comes from. */
  async function fetchLive() {
    const [sections, staff] = await Promise.all([
      window.PCCApi.rest(SECTION_SELECT),
      window.PCCApi.rest(STAFF_SELECT),
    ]);
    // Embedded rows aren't guaranteed to arrive ordered; sort defensively.
    sections.forEach(section => {
      (section.blocks || []).sort((a, b) => (a.position || 0) - (b.position || 0));
    });
    return { sections, staff };
  }

  async function fetchPage(slug) {
    const rows = await window.PCCApi.rest(
      `pages?select=slug,title,content&slug=eq.${encodeURIComponent(slug)}&limit=1`
    );
    if (!rows || !rows.length) return null;
    const content = rows[0].content || {};
    return {
      sections: content.sections || [],
      staff: content.staff || [],
      page: { slug: rows[0].slug, title: rows[0].title },
    };
  }

  async function fetchFallback() {
    const res = await fetch(window.PCC.FALLBACK_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Snapshot unavailable (${res.status})`);
    return res.json();
  }

  async function loadSite() {
    const slug = currentSlug();

    if (slug) {
      // A shared copy. There is no offline snapshot of one, so a failure here
      // is a failure — better than showing the handbook under its address.
      const data = await fetchPage(slug);
      return data ? { data, live: true } : { missing: true, live: true };
    }

    try {
      return { data: await fetchLive(), live: true };
    } catch (liveError) {
      console.error('[pcc] Live content unavailable, falling back to snapshot:', liveError);
      const data = await fetchFallback();
      return { data, live: false, liveError };
    }
  }

  /** Save back to wherever this page came from. */
  function savePayload(payload) {
    const slug = currentSlug();
    return slug
      ? window.PCCApi.rpc('save_page', { page_slug: slug, payload })
      : window.PCCApi.rpc('save_site', { payload });
  }

  /* ═══════════════════════════════════════════
     BUILDING
     ═══════════════════════════════════════════ */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** Photos are either an absolute Storage URL or a repo-relative path. */
  function photoSrc(url) {
    const value = (url || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    return value.replace(/^\/+/, '');
  }

  function initials(name) {
    return (name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .map(word => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  /** One content card: a small label above a body of rich text. */
  function buildBlock(label, bodyHtml) {
    const block = el('div', 'section-block');
    block.appendChild(el('div', 'section-label', label || ''));
    const body = el('div', 'content-body');
    setHtml(body, bodyHtml || '');
    block.appendChild(body);
    return block;
  }

  function buildStaffCard(person) {
    const card = el('article', 'staff-card');
    const url = photoSrc(person.photo_url);
    card.dataset.photoUrl = person.photo_url || '';

    if (url) {
      const img = el('img', 'staff-card__photo');
      img.src = url;
      img.alt = person.name || '';
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      card.appendChild(el('div', 'staff-card__photo-placeholder', initials(person.name)));
    }

    // textContent throughout — names and roles are data, never markup.
    card.appendChild(el('span', 'staff-card__name', person.name || ''));
    card.appendChild(el('span', 'staff-card__role', person.role || ''));

    const email = (person.email || '').trim();
    if (email) {
      const link = el('a', 'staff-card__email', email);
      link.href = `mailto:${email}`;
      card.appendChild(link);
    } else {
      card.appendChild(el('span', 'staff-card__email', ''));
    }
    return card;
  }

  function buildHeader(section, headingTag) {
    const header = el('div', 'section-header');
    const inner = el('div', 'section-header__inner');
    inner.appendChild(el('span', 'eyebrow', section.eyebrow || ''));
    const heading = document.createElement(headingTag);
    setInline(heading, section.title || '');
    inner.appendChild(heading);
    inner.appendChild(el('p', null, section.description || ''));
    header.appendChild(inner);
    return header;
  }

  function buildBody(contentId, contentClass) {
    const body = el('div', 'section-body');
    const inner = el('div', 'section-body__inner');
    const content = el('div', contentClass);
    content.id = contentId;
    inner.appendChild(content);
    body.appendChild(inner);
    return { body, content };
  }

  function buildSection(section, staff) {
    const node = el('section', 'section');
    node.id = section.id;
    node.dataset.kind = section.kind || 'grid';
    node.dataset.builtin = section.is_builtin ? 'true' : 'false';

    const contentId = `content-${section.id}`;

    if (section.kind === 'hero') {
      const hero = el('div', 'section-hero');
      const inner = el('div', 'section-hero__inner');
      inner.appendChild(el('span', 'eyebrow', section.eyebrow || ''));
      const h1 = document.createElement('h1');
      setInline(h1, section.title || '');
      inner.appendChild(h1);
      inner.appendChild(el('p', 'hero-sub', section.description || ''));
      hero.appendChild(inner);
      node.appendChild(hero);

      const { body, content } = buildBody(contentId, 'content-body welcome-letter');
      const first = (section.blocks || [])[0];
      setHtml(content, first ? first.body_html : '');
      node.appendChild(body);
      return node;
    }

    node.appendChild(buildHeader(section, 'h2'));

    if (section.kind === 'staff') {
      const { body, content } = buildBody(contentId, null);
      const grid = el('div', 'staff-grid');
      (staff || []).forEach(person => grid.appendChild(buildStaffCard(person)));
      content.appendChild(grid);
      node.appendChild(body);
      return node;
    }

    const { body, content } = buildBody(contentId, 'sections-grid');
    (section.blocks || []).forEach(block =>
      content.appendChild(buildBlock(block.label, block.body_html))
    );
    node.appendChild(body);
    return node;
  }

  function buildNavItem(id, label) {
    const li = document.createElement('li');
    li.dataset.for = id;
    const link = el('a', 'sidebar-link', label || '');
    link.href = `#${id}`;
    li.appendChild(link);
    return li;
  }

  /** Alternating background on every other non-hero section. */
  function updateSectionColors() {
    const sections = [...document.querySelectorAll('#sections .section')].filter(
      s => s.dataset.kind !== 'hero'
    );
    sections.forEach((s, i) => s.classList.toggle('section--alt', i % 2 !== 0));
  }

  function renderSite({ sections, staff }) {
    const host = document.getElementById('sections');
    const nav = document.getElementById('sidebarNav');

    host.replaceChildren();
    nav.replaceChildren();

    (sections || []).forEach(section => {
      host.appendChild(buildSection(section, staff));
      nav.appendChild(buildNavItem(section.id, section.nav_label || section.title));
    });

    updateSectionColors();
  }

  /* ═══════════════════════════════════════════
     SERIALIZING (read the DOM back out for saving)
     ═══════════════════════════════════════════ */

  /* Tags a contenteditable can leave behind that end a line. */
  const LINE_ENDERS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3']);

  /** Text of a field, keeping the line breaks typed into it — stored as plain
      "\n", which the CSS renders back as breaks. Read from the nodes rather
      than from innerText: innerText reflects styling, so a field set in
      uppercase would be *stored* uppercase, permanently. */
  function fieldText(node) {
    if (!node) return '';
    let text = '';
    (function walk(parent) {
      for (const child of parent.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === 'BR') {
            text += '\n';
          } else if (LINE_ENDERS.has(child.tagName)) {
            if (text && !text.endsWith('\n')) text += '\n';
            walk(child);
            text += '\n';
          } else {
            walk(child);
          }
        }
      }
    })(node);
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ') // runs of spaces collapse, exactly as they render
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** Same, for fields that only ever hold one line (emails, labels). */
  const oneLine = node => fieldText(node).replace(/\s+/g, ' ');

  const textOf = (root, selector) => fieldText(root.querySelector(selector));

  function serializeSection(node) {
    const kind = node.dataset.kind || 'grid';
    const contentId = `content-${node.id}`;
    const content = document.getElementById(contentId);
    const navLink = document.querySelector(`#sidebarNav li[data-for="${node.id}"] .sidebar-link`);

    const section = {
      id: node.id,
      kind,
      is_builtin: node.dataset.builtin === 'true',
      nav_label: oneLine(navLink),
      blocks: [],
    };

    if (kind === 'hero') {
      section.eyebrow = textOf(node, '.section-hero .eyebrow');
      section.title = cleanInline(node.querySelector('.section-hero h1')?.innerHTML || '');
      section.description = textOf(node, '.hero-sub');
      section.blocks = [{ label: '', body_html: cleanHtml(content ? content.innerHTML : '') }];
      return section;
    }

    section.eyebrow = textOf(node, '.section-header .eyebrow');
    section.title = cleanInline(node.querySelector('.section-header h2')?.innerHTML || '');
    section.description = textOf(node, '.section-header__inner > p');

    if (kind === 'staff') return section;

    section.blocks = [...(content ? content.querySelectorAll('.section-block') : [])].map(block => ({
      label: oneLine(block.querySelector('.section-label')),
      body_html: cleanHtml(block.querySelector('.content-body')?.innerHTML || ''),
    }));
    return section;
  }

  function serializeStaff() {
    const grid = document.querySelector('.staff-grid');
    if (!grid) return null;
    return [...grid.querySelectorAll('.staff-card')].map(card => ({
      name: fieldText(card.querySelector('.staff-card__name')),
      role: fieldText(card.querySelector('.staff-card__role')),
      email: oneLine(card.querySelector('.staff-card__email')),
      photo_url: card.dataset.photoUrl || '',
    }));
  }

  function serializeSite() {
    const sections = [...document.querySelectorAll('#sections .section')].map(serializeSection);
    const payload = { sections };
    const staff = serializeStaff();
    if (staff) payload.staff = staff;
    return payload;
  }

  /* ═══════════════════════════════════════════
     NAV BEHAVIOUR
     ═══════════════════════════════════════════ */

  let scrollSpy = null;

  function initScrollSpy() {
    if (scrollSpy) scrollSpy.disconnect();
    const links = () => document.querySelectorAll('.sidebar-link');
    scrollSpy = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          links().forEach(l => l.classList.remove('active'));
          const active = document.querySelector(
            `.sidebar-link[href="#${entry.target.id}"]`
          );
          if (active) active.classList.add('active');
        });
      },
      { rootMargin: '0px 0px -80% 0px', threshold: 0 }
    );
    document.querySelectorAll('#sections .section[id]').forEach(s => scrollSpy.observe(s));
  }

  function initMobileMenu() {
    const toggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    if (!toggle || !sidebar) return;

    const setOpen = open => {
      document.body.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };

    toggle.addEventListener('click', () =>
      setOpen(!document.body.classList.contains('menu-open'))
    );
    sidebar.addEventListener('click', e => {
      if (e.target.closest('.sidebar-link')) setOpen(false);
    });
    document.addEventListener('click', e => {
      if (
        document.body.classList.contains('menu-open') &&
        !sidebar.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        setOpen(false);
      }
    });
    setOpen(false);
  }

  /* Delegated so it keeps working after the nav is re-rendered. */
  function initSmoothScroll() {
    document.addEventListener('click', e => {
      const anchor = e.target.closest('a[href^="#"]');
      if (!anchor) return;
      // A link being edited belongs to the editor, not to the nav.
      if (anchor.closest('[contenteditable="true"]')) return;
      const id = anchor.getAttribute('href').slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const offset = window.innerWidth <= 720 ? 52 : 0;
      window.scrollTo({
        top: target.getBoundingClientRect().top + window.scrollY - offset,
        behavior: 'smooth',
      });
      if (history.replaceState) history.replaceState(null, '', `#${id}`);
    });
  }

  /* ═══════════════════════════════════════════
     BOOT
     ═══════════════════════════════════════════ */

  function showFatal(message) {
    const host = document.getElementById('sections');
    host.replaceChildren();
    const wrap = el('div', 'load-error');
    wrap.appendChild(el('h2', null, "This page couldn't load"));
    wrap.appendChild(el('p', null, message));
    host.appendChild(wrap);
  }

  /** Nothing lives at this address — say so rather than leaving a blank page. */
  function showMissing() {
    const host = document.getElementById('sections');
    document.getElementById('sidebarNav')?.replaceChildren();
    host.replaceChildren();
    const wrap = el('div', 'load-error');
    wrap.appendChild(el('h2', null, 'There is no page here'));
    wrap.appendChild(
      el('p', null, `Nothing is published at /${currentSlug()}. It may have been renamed or removed.`)
    );
    const back = el('a', 'btn', 'Go to the handbook');
    back.href = '/';
    wrap.appendChild(back);
    host.appendChild(wrap);
    document.title = 'Page not found — Passion City Worship Team';
  }

  /** Re-read content and repaint. Used on first load, and again after a save
      so the page shows exactly what ended up in the database. */
  async function reload() {
    let result;
    try {
      result = await loadSite();
    } catch (err) {
      console.error('[pcc] Unable to load content from any source:', err);
      window.PCCSite.isLive = false;
      showFatal(
        'We could not reach the handbook content. Please refresh, or email ' +
          'worship@passioncitychurch.com if this keeps happening.'
      );
      window.dispatchEvent(new CustomEvent('pcc:rendered', { detail: { live: false } }));
      return false;
    }

    if (result.missing) {
      // A slug nobody has made, or one that has since been deleted.
      window.PCCSite.isLive = false;
      showMissing();
      window.dispatchEvent(new CustomEvent('pcc:rendered', { detail: { live: false } }));
      return false;
    }

    renderSite(result.data);
    window.PCCSite.page = (result.data && result.data.page) || null;
    if (window.PCCSite.page && window.PCCSite.page.title) {
      document.title = `${window.PCCSite.page.title} — Passion City Worship Team`;
    }
    initScrollSpy();
    document.body.classList.toggle('is-stale', !result.live);
    window.PCCSite.isLive = result.live;
    window.dispatchEvent(new CustomEvent('pcc:rendered', { detail: { live: result.live } }));
    return result.live;
  }

  /* A staff-only address fetches nothing without a session — the page is a
     sign-in form then, and there is nothing to put on screen. */
  const readable = () =>
    window.PCCApi.isSignedIn() || !window.PCCEnv || !window.PCCEnv.requiresSignIn();

  function clearContent() {
    document.getElementById('sections')?.replaceChildren();
    document.getElementById('sidebarNav')?.replaceChildren();
    window.PCCSite.isLive = false;
    window.PCCSite.page = null;
  }

  async function boot() {
    // One-time listeners; reload() may run many times after this.
    initMobileMenu();
    initSmoothScroll();

    if (!readable()) {
      clearContent();
      return;
    }

    await reload();

    // Jump to the hash target now that the sections actually exist.
    if (location.hash.length > 1) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  /* Signing in loads a staff-only page. Signing out takes one off the screen —
     but the handbook stays up, since reading it never needed an account. */
  window.addEventListener('pcc:auth', async () => {
    if (!readable()) {
      clearContent();
      return;
    }
    if (!document.querySelector('#sections .section')) await reload();
  });

  window.PCCSite = {
    boot,
    reload,
    loadSite,
    renderSite,
    buildSection,
    buildBlock,
    buildStaffCard,
    buildNavItem,
    updateSectionColors,
    initScrollSpy,
    serializeSite,
    savePayload,
    currentSlug,
    fieldText,
    photoSrc,
    initials,
    isLive: false,
    page: null,
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
