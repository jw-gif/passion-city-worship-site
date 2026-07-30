/* =============================================
   HTML sanitizer

   Content is authored in contenteditable and stored as HTML, so it is
   sanitized on the way *in* (before saving) and on the way *out* (before
   rendering). Defence in depth: a bad row in the database still can't run
   script in a visitor's browser.

   The allowlist is deliberately tiny — exactly the tags the format toolbar
   can produce. Unknown elements are unwrapped (their text survives),
   dangerous containers are dropped outright.
   ============================================= */
(function () {
  'use strict';

  const BLOCK_TAGS  = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'A']);
  const INLINE_TAGS = new Set(['BR', 'STRONG', 'EM', 'U', 'A']);

  /* Dropped together with their contents. */
  const DROP = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
    'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON',
    'TEXTAREA', 'SELECT', 'AUDIO', 'VIDEO', 'CANVAS',
  ]);

  /* execCommand still emits these; fold them into semantic tags. */
  const NORMALIZE = { B: 'STRONG', I: 'EM', DIV: 'P' };

  const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

  /** Returns the href unchanged if safe, or null if it must be dropped. */
  function safeHref(raw) {
    const value = (raw || '').trim();
    if (!value) return null;
    if (value.startsWith('#')) return value;
    // Protocol-relative URLs ("//host") are not used here and are an easy
    // way to smuggle in a third-party origin, so they're rejected.
    if (value.startsWith('//')) return null;
    let parsed;
    try {
      parsed = new URL(value, document.baseURI);
    } catch {
      return null;
    }
    return SAFE_PROTOCOLS.includes(parsed.protocol) ? value : null;
  }

  function isExternal(href) {
    if (!/^https?:/i.test(href)) return false;
    try {
      return new URL(href, document.baseURI).origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  function walk(source, allowed, target) {
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const original = child.tagName.toUpperCase();
      if (DROP.has(original)) continue;

      const tag = NORMALIZE[original] || original;

      // Unknown-but-harmless wrapper: keep the children, discard the wrapper.
      if (!allowed.has(tag)) {
        walk(child, allowed, target);
        continue;
      }

      if (tag === 'A') {
        const href = safeHref(child.getAttribute('href'));
        if (!href) {
          // Unsafe link: keep the visible text, lose the link.
          walk(child, allowed, target);
          continue;
        }
        const anchor = document.createElement('a');
        anchor.setAttribute('href', href);
        if (isExternal(href)) {
          anchor.setAttribute('target', '_blank');
          anchor.setAttribute('rel', 'noopener noreferrer');
        }
        walk(child, allowed, anchor);
        target.appendChild(anchor);
        continue;
      }

      const clean = document.createElement(tag.toLowerCase());
      walk(child, allowed, clean);
      target.appendChild(clean);
    }
  }

  /* Parsing in a detached document means nothing loads or executes while we
     inspect it. */
  function parse(html) {
    return new DOMParser().parseFromString(
      '<!doctype html><body>' + (html || ''),
      'text/html'
    ).body;
  }

  function toFragment(html, allowed) {
    const frag = document.createDocumentFragment();
    walk(parse(html), allowed, frag);
    return frag;
  }

  function toHtml(html, allowed) {
    const holder = document.createElement('div');
    holder.appendChild(toFragment(html, allowed));
    return holder.innerHTML;
  }

  /** Replace an element's children with sanitized block-level content. */
  function setHtml(element, html) {
    element.replaceChildren(toFragment(html, BLOCK_TAGS));
  }

  /** Replace an element's children with sanitized inline content only. */
  function setInline(element, html) {
    element.replaceChildren(toFragment(html, INLINE_TAGS));
  }

  window.PCCSanitize = {
    html: html => toHtml(html, BLOCK_TAGS),
    inline: html => toHtml(html, INLINE_TAGS),
    setHtml,
    setInline,
    safeHref,
  };
})();
