/* =============================================
   In-place editor

   Same interaction as before — click Edit, change things on the page, save —
   but changes now go to the database, so everyone sees them. The editor is
   only reachable by a signed-in editor, and only when the page is showing
   live data (never when it fell back to the bundled snapshot, which would
   otherwise let a stale copy overwrite the real content).
   ============================================= */
(function () {
  'use strict';

  const api = window.PCCApi;
  const site = window.PCCSite;

  let editMode = false;
  let snapshot = null; // data-level snapshot, used by Cancel
  let saving = false;

  const fab = () => document.getElementById('editFab');
  const navLinkFor = id =>
    document.querySelector(`#sidebarNav li[data-for="${id}"] .sidebar-link`);

  /* ═══════════════════════════════════════════
     TOAST
     ═══════════════════════════════════════════ */

  function showToast(message, isError) {
    let toast = document.getElementById('editor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'editor-toast';
      toast.className = 'editor-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('editor-toast--error', !!isError);
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), isError ? 6000 : 2400);
  }

  /* ═══════════════════════════════════════════
     EDITABLE FIELDS
     ═══════════════════════════════════════════ */

  function makeEditable(node, opts = {}) {
    if (!node) return;
    node.contentEditable = 'true';
    node.spellcheck = opts.spellcheck !== false;
    if (opts.plain) node.dataset.plainText = '1';
  }

  /* A handful of fields are meaningless split across lines — an address, a
     sidebar label, a category eyebrow. Every other plain-text field takes a
     line break on Enter. */
  const SINGLE_LINE = '.staff-card__email, .sidebar-link, .eyebrow, .section-label';

  const plainField = target => {
    const field = target.closest?.('[contenteditable="true"]');
    return field && field.dataset.plainText ? field : null;
  };

  /* Pasting into a plain-text field (labels, headings, roles) should not drag
     along the source document's markup. */
  document.addEventListener('paste', e => {
    if (!editMode) return;
    const field = plainField(e.target);
    if (!field) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand(
      'insertText',
      false,
      field.matches(SINGLE_LINE) ? text.replace(/\s*\n\s*/g, ' ') : text.trim()
    );
  });

  /** Enter in a plain-text field: a line break, never a new paragraph. */
  function insertLineBreak() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    // A <br> at the very end of a field renders nothing on its own, so the
    // caret would have nowhere to land; the second one is the usual fix, and
    // it serializes away with the trailing whitespace.
    if (!br.nextSibling) br.after(document.createElement('br'));
    range.setStartAfter(br);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  document.addEventListener('keydown', e => {
    if (!editMode || e.key !== 'Enter') return;
    const field = plainField(e.target);
    if (!field) return; // rich bodies keep their paragraphs
    e.preventDefault();
    if (!field.matches(SINGLE_LINE)) insertLineBreak();
  });

  function selectAll(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /* ═══════════════════════════════════════════
     SECTION HEADERS + NAV
     ═══════════════════════════════════════════ */

  function enableSectionHeader(section) {
    const isHero = section.dataset.kind === 'hero';
    const scope = isHero ? '.section-hero' : '.section-header';
    const eyebrow = section.querySelector(`${scope} .eyebrow`);
    const heading = section.querySelector(`${scope} ${isHero ? 'h1' : 'h2'}`);
    const description = isHero
      ? section.querySelector('.hero-sub')
      : section.querySelector('.section-header__inner > p');

    makeEditable(eyebrow, { plain: true, spellcheck: false });
    makeEditable(heading, { plain: true });
    makeEditable(description, { plain: true });

    // Keep the sidebar label in step with the heading, but only while the two
    // still agree — once someone edits the label directly, leave it alone.
    // A heading may be broken over lines; the sidebar label stays on one.
    const label = node => site.fieldText(node).replace(/\s+/g, ' ');
    const link = navLinkFor(section.id);
    if (heading && link && label(link) === label(heading)) {
      heading.addEventListener('input', () => {
        link.textContent = label(heading);
      });
    }
  }

  function enableNavEditing() {
    document.querySelectorAll('#sidebarNav li').forEach(item => {
      const link = item.querySelector('.sidebar-link');
      if (link && !link.isContentEditable) {
        makeEditable(link, { plain: true, spellcheck: false });
        // Don't navigate away mid-edit.
        link.addEventListener('click', e => {
          if (editMode) e.preventDefault();
        });
      }
      // Sorting the sidebar sorts the page: a link and its section move together.
      addGrip(item, {
        kind: 'nav',
        selector: 'li',
        label: 'Reorder this section',
        scroll: false,
        onDrop: applyNavOrder,
      });
    });
  }

  function addSectionDeleteButton(section) {
    const host = section.querySelector('.section-header') || section.querySelector('.section-hero');
    if (!host) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ec section-delete-btn';
    button.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
      '<path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" fill="none"/></svg> Remove section';
    button.addEventListener('click', () => {
      const remaining = document.querySelectorAll('#sections .section').length;
      if (remaining <= 1) {
        showToast('A site needs at least one section.', true);
        return;
      }
      const heading = section.querySelector('h1, h2');
      const name = heading ? heading.textContent.trim() : 'this section';
      if (!confirm(`Remove "${name}" and everything in it?`)) return;
      const navItem = document.querySelector(`#sidebarNav li[data-for="${section.id}"]`);
      if (navItem) navItem.remove();
      section.remove();
      site.updateSectionColors();
    });
    host.appendChild(button);
  }

  /* ═══════════════════════════════════════════
     CONTENT BLOCKS
     ═══════════════════════════════════════════ */

  function enableBlock(block) {
    makeEditable(block.querySelector('.section-label'), { plain: true, spellcheck: false });
    makeEditable(block.querySelector('.content-body'));

    addGrip(block, {
      kind: 'block',
      selector: '.section-block',
      label: 'Reorder this block',
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ec block-delete-btn';
    remove.title = 'Remove block';
    remove.setAttribute('aria-label', 'Remove block');
    remove.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
      '<path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" fill="none"/></svg>';
    remove.addEventListener('click', () => {
      if (confirm('Remove this block?')) block.remove();
    });
    block.appendChild(remove);
  }

  function initBlockControls(section) {
    const grid = document.getElementById(`content-${section.id}`);
    if (!grid || section.dataset.kind !== 'grid') return;

    grid.querySelectorAll('.section-block').forEach(enableBlock);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'ec add-block-btn';
    add.innerHTML = '<span class="add-block-icon">+</span> Add block';
    add.addEventListener('click', () => {
      const block = site.buildBlock('Label', '<p>Enter content…</p>');
      enableBlock(block);
      grid.insertBefore(block, add);
      const label = block.querySelector('.section-label');
      if (label) {
        label.focus();
        selectAll(label);
      }
    });
    grid.appendChild(add);
  }

  /* ═══════════════════════════════════════════
     STAFF
     ═══════════════════════════════════════════ */

  /** Swap in a new photo node (image or initials placeholder) and rewire it. */
  function setCardPhoto(card, src, name) {
    const existing = card.querySelector('.staff-card__photo, .staff-card__photo-placeholder');
    let node;
    if (src) {
      node = document.createElement('img');
      node.className = 'staff-card__photo';
      node.src = src;
      node.alt = name || '';
      node.loading = 'lazy';
    } else {
      node = document.createElement('div');
      node.className = 'staff-card__photo-placeholder';
      node.textContent = site.initials(name);
    }
    if (existing) existing.replaceWith(node);
    else card.prepend(node);
    if (editMode) wirePhoto(card, node);
    return node;
  }

  function wirePhoto(card, node) {
    const photo = node || card.querySelector('.staff-card__photo, .staff-card__photo-placeholder');
    if (!photo || photo.dataset.wired) return;
    photo.dataset.wired = '1';
    photo.title = 'Click to change photo';
    photo.style.cursor = 'pointer';
    photo.addEventListener('click', () => choosePhoto(card));
  }

  function choosePhoto(card) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        showToast('That image is over 5 MB — please pick a smaller one.', true);
        return;
      }

      const name = card.querySelector('.staff-card__name')?.textContent.trim() || '';
      const previous = card.dataset.photoUrl || '';
      const preview = URL.createObjectURL(file);

      card.classList.add('is-uploading');
      setCardPhoto(card, preview, name);

      try {
        const url = await api.uploadPhoto(file);
        card.dataset.photoUrl = url;
        setCardPhoto(card, url, name);
        showToast('Photo uploaded — remember to save.');
      } catch (err) {
        card.dataset.photoUrl = previous;
        setCardPhoto(card, site.photoSrc(previous), name);
        showToast(err.message || 'That photo could not be uploaded.', true);
      } finally {
        URL.revokeObjectURL(preview);
        card.classList.remove('is-uploading');
      }
    });
    input.click();
  }

  /* ── Reordering ──
     One engine for everything that can be sorted: staff cards, content blocks,
     and sidebar links (which carry their whole section with them). Items are
     dragged by a small grip rather than by the item itself — names, roles, and
     bodies are contenteditable while editing, and a draggable item would fight
     with selecting text inside them. Pointer events cover mouse, touch, and pen
     in one code path. Nothing is written here: the new order is simply the DOM
     order, which serializeSite() already reads on save. */

  const SCROLL_EDGE = 64; // distance from the viewport edge that auto-scrolls
  const SCROLL_MAX = 16; // px per frame, at the very edge
  const GRIP_SVG =
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">' +
    '<circle cx="3.5" cy="2" r="1"/><circle cx="6.5" cy="2" r="1"/>' +
    '<circle cx="3.5" cy="5" r="1"/><circle cx="6.5" cy="5" r="1"/>' +
    '<circle cx="3.5" cy="8" r="1"/><circle cx="6.5" cy="8" r="1"/></svg>';

  const gripOptions = new WeakMap();
  let drag = null;

  /**
   * Give an item a grip that reorders it among its siblings.
   * @param item     the element that moves
   * @param options  kind: style variant; selector: what its siblings look like;
   *                 label: for screen readers; onDrop: run after a reorder;
   *                 scroll: false to skip edge auto-scrolling
   */
  function addGrip(item, options) {
    if (item.querySelector(':scope > .drag-grip')) return;
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = `ec drag-grip drag-grip--${options.kind}`;
    grip.title = 'Drag to reorder — or use the arrow keys';
    grip.setAttribute('aria-label', options.label);
    grip.innerHTML = GRIP_SVG;
    gripOptions.set(grip, options);
    grip.addEventListener('pointerdown', startDrag);
    grip.addEventListener('keydown', nudgeItem);
    item.appendChild(grip);
  }

  const siblingsOf = drag => [...drag.container.querySelectorAll(`:scope > ${drag.selector}`)];

  /** Keep the dragged item under the pointer. Measured fresh each time so it
      stays correct after the item is moved in the DOM or the page scrolls. */
  function placeItem() {
    const item = drag.item;
    item.style.transform = '';
    const rect = item.getBoundingClientRect();
    item.style.transform =
      `translate(${drag.x - drag.grabX - rect.left}px, ${drag.y - drag.grabY - rect.top}px)`;
  }

  /** The topmost other item beneath the pointer, if any. */
  function itemUnder(x, y) {
    for (const node of document.elementsFromPoint(x, y)) {
      const item = node.closest && node.closest(drag.selector);
      if (item && item !== drag.item && item.parentElement === drag.container) return item;
    }
    return null;
  }

  function updateDrag() {
    const target = itemUnder(drag.x, drag.y);
    if (target) {
      // Moving forwards drops in after the target, backwards drops in before it.
      const itemIsLater =
        target.compareDocumentPosition(drag.item) & Node.DOCUMENT_POSITION_FOLLOWING;
      drag.container.insertBefore(drag.item, itemIsLater ? target : target.nextSibling);
    }
    placeItem();
  }

  /** Scroll the page when the pointer is dragged near the top or bottom edge. */
  function autoScroll() {
    if (!drag) return;
    const above = drag.y - SCROLL_EDGE;
    const below = window.innerHeight - SCROLL_EDGE - drag.y;
    let dy = 0;
    if (above < 0) dy = Math.max(above / SCROLL_EDGE, -1) * SCROLL_MAX;
    else if (below < 0) dy = Math.min(-below / SCROLL_EDGE, 1) * SCROLL_MAX;
    if (dy) {
      // Instant, not the page's smooth default — each frame is its own step.
      window.scrollBy({ top: dy, behavior: 'instant' });
      updateDrag();
    }
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function startDrag(e) {
    if (!editMode || drag || (e.button != null && e.button > 0)) return;
    const grip = e.currentTarget;
    const options = gripOptions.get(grip);
    const item = options && grip.closest(options.selector);
    const container = item && item.parentElement;
    if (!container) return;

    e.preventDefault();
    const rect = item.getBoundingClientRect();
    drag = {
      item,
      container,
      grip,
      selector: options.selector,
      onDrop: options.onDrop,
      pointerId: e.pointerId,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      x: e.clientX,
      y: e.clientY,
      // Where the item sat when the drag began, so Escape can put it back.
      origin: item.nextElementSibling,
      frame: 0,
    };
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* Capture is a nicety; document-level listeners carry the drag anyway. */
    }
    item.classList.add('is-dragging');
    document.body.classList.add('is-reordering');
    placeItem();
    // The sidebar list is short and always on screen, so it needs no scrolling.
    if (options.scroll !== false) drag.frame = requestAnimationFrame(autoScroll);
  }

  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.x = e.clientX;
    drag.y = e.clientY;
    updateDrag();
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    cancelAnimationFrame(drag.frame);
    drag.item.style.transform = '';
    drag.item.classList.remove('is-dragging');
    document.body.classList.remove('is-reordering');
    try {
      drag.grip.releasePointerCapture(drag.pointerId);
    } catch {
      /* Already released — the pointer went away. */
    }
    const moved = drag.item.nextElementSibling !== drag.origin;
    const onDrop = drag.onDrop;
    drag = null;
    if (moved && onDrop) onDrop();
  }

  /** Escape mid-drag: put the item back where it started. */
  function cancelDrag() {
    if (!drag) return;
    drag.container.insertBefore(drag.item, drag.origin);
    endDrag();
  }

  document.addEventListener('pointermove', moveDrag);
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  /** Keyboard equivalent of the drag, for anyone not using a pointer. */
  function nudgeItem(e) {
    const grip = e.currentTarget;
    const options = gripOptions.get(grip);
    const item = options && grip.closest(options.selector);
    const container = item && item.parentElement;
    if (!container) return;

    const items = siblingsOf({ container, selector: options.selector });
    const from = items.indexOf(item);
    let to = from;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = from - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = from + 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = items.length - 1;
    else return;

    e.preventDefault();
    e.stopPropagation();
    if (from < 0 || to === from || to < 0 || to >= items.length) return;

    container.insertBefore(item, to > from ? items[to].nextSibling : items[to]);
    grip.focus();
    if (options.onDrop) options.onDrop();
    showToast(`Moved to ${to + 1} of ${items.length}`);
  }

  /** Sections follow their sidebar links, so dropping a link moves its section. */
  function applyNavOrder() {
    const host = document.getElementById('sections');
    const addButton = host.querySelector('.add-section-btn');
    document.querySelectorAll('#sidebarNav li').forEach(li => {
      const section = document.getElementById(li.dataset.for);
      if (section) host.appendChild(section);
    });
    if (addButton) host.appendChild(addButton); // stays last
    site.updateSectionColors();
  }

  function enableStaffCard(card) {
    makeEditable(card.querySelector('.staff-card__name'), { plain: true, spellcheck: false });
    makeEditable(card.querySelector('.staff-card__role'), { plain: true, spellcheck: false });

    // An anchor can't be typed into comfortably; swap it for a span while editing.
    const link = card.querySelector('a.staff-card__email');
    if (link) {
      const span = document.createElement('span');
      span.className = 'staff-card__email';
      span.textContent = link.textContent;
      link.replaceWith(span);
    }
    makeEditable(card.querySelector('span.staff-card__email'), {
      plain: true,
      spellcheck: false,
    });

    wirePhoto(card);
    addGrip(card, {
      kind: 'staff',
      selector: '.staff-card',
      label: 'Reorder this person',
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ec staff-delete-btn';
    remove.title = 'Remove';
    remove.setAttribute('aria-label', 'Remove staff member');
    remove.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">' +
      '<path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" fill="none"/></svg>';
    remove.addEventListener('click', () => {
      const name = card.querySelector('.staff-card__name')?.textContent.trim() || 'this person';
      if (confirm(`Remove ${name} from the directory?`)) card.remove();
    });
    card.appendChild(remove);
  }

  function initStaffControls() {
    const grid = document.querySelector('.staff-grid');
    if (!grid) return;
    grid.querySelectorAll('.staff-card').forEach(enableStaffCard);

    const add = document.createElement('div');
    add.className = 'ec staff-add-card';
    add.setAttribute('role', 'button');
    add.tabIndex = 0;
    add.innerHTML =
      '<div class="staff-add-card__icon">+</div><span>Add staff member</span>';
    const addCard = () => {
      const card = site.buildStaffCard({ name: 'Name', role: 'Role', email: '', photo_url: '' });
      grid.insertBefore(card, add);
      enableStaffCard(card);
      const name = card.querySelector('.staff-card__name');
      if (name) {
        name.focus();
        selectAll(name);
      }
    };
    add.addEventListener('click', addCard);
    add.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        addCard();
      }
    });
    grid.appendChild(add);
  }

  /* ═══════════════════════════════════════════
     ADD SECTION
     ═══════════════════════════════════════════ */

  function addAddSectionButton() {
    const host = document.getElementById('sections');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ec add-section-btn';
    button.innerHTML =
      '<span style="font-size:1.2rem;font-weight:300">+</span> Add new section';
    button.addEventListener('click', () => {
      const id = `custom-${Date.now()}`;
      const data = {
        id,
        kind: 'grid',
        eyebrow: 'Category',
        title: 'New Section',
        nav_label: 'New Section',
        description: 'Section description',
        is_builtin: false,
        blocks: [],
      };
      const node = site.buildSection(data, []);
      host.appendChild(node);
      document.getElementById('sidebarNav').appendChild(site.buildNavItem(id, data.nav_label));

      site.updateSectionColors();
      enableSectionHeader(node);
      initBlockControls(node);
      addSectionDeleteButton(node);
      enableNavEditing();

      const heading = node.querySelector('h2');
      if (heading) {
        heading.focus();
        selectAll(heading);
      }
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Keep the button last.
      host.appendChild(button);
    });
    host.appendChild(button);
  }

  /* ═══════════════════════════════════════════
     ENTER / EXIT
     ═══════════════════════════════════════════ */

  function enterEdit() {
    if (editMode) return;
    if (!api.isSignedIn()) {
      showToast('Please sign in to edit.', true);
      return;
    }
    if (!site.isLive) {
      showToast(
        'Editing is unavailable while the site is showing offline content. Please refresh and try again.',
        true
      );
      return;
    }

    editMode = true;
    snapshot = site.serializeSite();
    document.body.classList.add('edit-mode');

    document.querySelectorAll('#sections .section').forEach(section => {
      enableSectionHeader(section);
      initBlockControls(section);
      addSectionDeleteButton(section);

      if (section.dataset.kind === 'hero') {
        makeEditable(document.getElementById(`content-${section.id}`));
      }
    });

    initStaffControls();
    enableNavEditing();
    addAddSectionButton();

    document.getElementById('fabIdle').hidden = true;
    document.getElementById('fabActive').hidden = false;
  }

  function teardownEditUi() {
    endDrag(); // in case edit mode ends while a card is being dragged
    document.body.classList.remove('edit-mode');
    document.querySelectorAll('.ec').forEach(node => node.remove());
    document.querySelectorAll('[contenteditable]').forEach(node => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('spellcheck');
      delete node.dataset.plainText;
    });
    document.getElementById('fabIdle').hidden = false;
    document.getElementById('fabActive').hidden = true;
    hideToolbar();
  }

  async function saveChanges() {
    if (saving) return;

    // Staging previews code, not content: it reads and writes the same
    // database as the live site, so a save here is a real edit.
    if (
      window.PCCEnv &&
      window.PCCEnv.isStaging() &&
      !confirm(
        'This is the staging preview, but content is shared with the live site — ' +
          'saving changes the real handbook. Save anyway?'
      )
    ) {
      return;
    }

    const payload = site.serializeSite();

    if (!payload.sections.length) {
      showToast('A site needs at least one section.', true);
      return;
    }

    saving = true;
    const saveButton = document.getElementById('saveBtn');
    const originalLabel = saveButton.textContent;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';

    try {
      await site.savePayload(payload);
      editMode = false;
      teardownEditUi();
      // Re-read from the database so what's on screen is exactly what's stored.
      await site.reload();
      showToast('Changes saved — everyone can see them now.');
    } catch (err) {
      // Stay in edit mode so nothing typed is lost.
      console.error('[pcc] Save failed:', err);
      showToast(err.message || 'Your changes could not be saved.', true);
    } finally {
      saving = false;
      saveButton.disabled = false;
      saveButton.textContent = originalLabel;
    }
  }

  function cancelChanges() {
    if (saving) return;
    if (!confirm('Discard unsaved changes?')) return;
    editMode = false;
    teardownEditUi();
    if (snapshot) site.renderSite(snapshot);
    site.initScrollSpy();
    snapshot = null;
  }

  /* ═══════════════════════════════════════════
     FORMAT TOOLBAR
     ═══════════════════════════════════════════ */

  const toolbar = document.getElementById('format-toolbar');

  function hideToolbar() {
    if (!toolbar) return;
    toolbar.setAttribute('aria-hidden', 'true');
    toolbar.classList.remove('visible');
  }

  function showToolbarAt(rect) {
    toolbar.removeAttribute('aria-hidden');
    toolbar.classList.add('visible');
    requestAnimationFrame(() => {
      let top = rect.top + window.scrollY - toolbar.offsetHeight - 8;
      let left =
        rect.left + window.scrollX + rect.width / 2 - toolbar.offsetWidth / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - toolbar.offsetWidth - 8));
      if (top < window.scrollY + 8) top = rect.bottom + window.scrollY + 8;
      toolbar.style.top = `${top}px`;
      toolbar.style.left = `${left}px`;
    });
  }

  const RICH_BODY = '.content-body[contenteditable="true"]';

  /** The rich-text body the caret is currently in, if any. */
  function currentBody() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    let node = selection.anchorNode;
    while (node && node.nodeType !== 1) node = node.parentNode;
    return node ? node.closest(RICH_BODY) : null;
  }

  /** The link the caret is inside, if any. */
  function currentLink() {
    const body = currentBody();
    if (!body) return null;
    let node = window.getSelection().anchorNode;
    while (node && node.nodeType !== 1) node = node.parentNode;
    const link = node && node.closest('a');
    return link && body.contains(link) ? link : null;
  }

  /** Light up the link controls to match whatever the caret is in. */
  function syncToolbarState(link) {
    toolbar.querySelectorAll('button[data-cmd]').forEach(button => {
      const cmd = button.dataset.cmd;
      if (cmd === 'link') button.classList.toggle('active', !!link);
      else if (cmd === 'btn') button.classList.toggle('active', !!link && link.classList.contains('btn'));
      else if (cmd === 'unlink') button.hidden = !link;
    });
  }

  document.addEventListener('selectionchange', () => {
    if (!editMode || !toolbar) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !currentBody()) {
      hideToolbar();
      return;
    }
    // Selected text can be formatted; a caret resting inside a link opens the
    // toolbar too, so an existing link can be edited without selecting it.
    const link = currentLink();
    if (selection.isCollapsed && !link) {
      hideToolbar();
      return;
    }
    const rect =
      selection.isCollapsed && link
        ? link.getBoundingClientRect()
        : selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width) {
      hideToolbar();
      return;
    }
    syncToolbarState(link);
    showToolbarAt(rect);
  });

  /* ── Links and buttons ── */

  /** Put the caret back where it was before a prompt stole the focus. */
  function keepSelection() {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const body = currentBody();
    return () => {
      if (!body || !range) return;
      body.focus({ preventScroll: true });
      const restored = window.getSelection();
      restored.removeAllRanges();
      restored.addRange(range);
    };
  }

  /** Create a link over the selection, or re-address the one already there. */
  function editLink() {
    const existing = currentLink();
    const restore = keepSelection();
    const answer = prompt(
      'Link address — a web address, mailto:someone@example.com, or #section',
      existing ? existing.getAttribute('href') : 'https://'
    );
    restore();
    if (answer === null) return; // cancelled

    const href = answer.trim();
    if (!href) {
      removeLink();
      return;
    }
    const safe = window.PCCSanitize.safeHref(href);
    if (!safe) {
      showToast('That link address is not allowed.', true);
      return;
    }
    if (existing) {
      existing.setAttribute('href', safe);
    } else if (window.getSelection().isCollapsed) {
      showToast('Select the words you want to link first.', true);
      return;
    } else {
      document.execCommand('createLink', false, safe);
    }
    syncToolbarState(currentLink());
  }

  /** Unwrap a link, keeping its text. */
  function removeLink() {
    const link = currentLink();
    if (!link) return;
    const parent = link.parentNode;
    while (link.firstChild) parent.insertBefore(link.firstChild, link);
    parent.removeChild(link);
    parent.normalize();
    hideToolbar();
  }

  /** A button is a link wearing one extra class, so this is a toggle. */
  function toggleButton() {
    let link = currentLink();
    if (!link) {
      editLink(); // needs an address before it can be anything
      link = currentLink();
      if (!link) return;
    }
    link.classList.toggle('btn');
    syncToolbarState(link);
  }

  if (toolbar) {
    toolbar.addEventListener('mousedown', e => {
      const button = e.target.closest('button[data-cmd]');
      if (!button) return;
      e.preventDefault();
      const cmd = button.dataset.cmd;
      // execCommand is deprecated but remains the only broadly supported way
      // to format a contenteditable region without shipping an editor library.
      if (cmd === 'h2') document.execCommand('formatBlock', false, 'h2');
      else if (cmd === 'h3') document.execCommand('formatBlock', false, 'h3');
      else if (cmd === 'p') document.execCommand('formatBlock', false, 'p');
      else if (cmd === 'ul') document.execCommand('insertUnorderedList');
      else if (cmd === 'ol') document.execCommand('insertOrderedList');
      else if (cmd === 'link') editLink();
      else if (cmd === 'unlink') removeLink();
      else if (cmd === 'btn') toggleButton();
      else if (cmd === 'removeFormat') {
        document.execCommand('removeFormat');
        // Clearing formatting drops the link too, which is what it looks like
        // it should do — execCommand leaves anchors alone.
        removeLink();
        document.execCommand('formatBlock', false, 'p');
      } else document.execCommand(cmd);
    });
  }

  /* A link inside the page is for editing while edit mode is on, not for
     following — clicking one puts the caret in it and opens the toolbar. */
  document.addEventListener(
    'click',
    e => {
      if (!editMode) return;
      const link = e.target.closest?.('a');
      if (link && link.closest('[contenteditable="true"]')) e.preventDefault();
    },
    true
  );

  /* ═══════════════════════════════════════════
     WIRING
     ═══════════════════════════════════════════ */

  function syncFabVisibility() {
    const node = fab();
    if (!node) return;
    const allowed = api.isSignedIn() && site.isLive;
    node.hidden = !allowed;
    if (!allowed && editMode) {
      editMode = false;
      teardownEditUi();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('editBtn')?.addEventListener('click', enterEdit);
    document.getElementById('saveBtn')?.addEventListener('click', saveChanges);
    document.getElementById('cancelBtn')?.addEventListener('click', cancelChanges);
    syncFabVisibility();
  });

  window.addEventListener('pcc:auth', syncFabVisibility);
  window.addEventListener('pcc:rendered', syncFabVisibility);

  document.addEventListener('keydown', e => {
    if (!editMode) return;
    if (e.key === 'Escape') {
      // Mid-drag, Escape belongs to the drag — it shouldn't discard the edit.
      if (drag) cancelDrag();
      else cancelChanges();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveChanges();
    }
  });

  // Don't let someone wander off mid-edit without warning.
  window.addEventListener('beforeunload', e => {
    if (!editMode) return;
    e.preventDefault();
    e.returnValue = '';
  });

  window.PCCEditor = { showToast, isEditing: () => editMode };
})();
