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

  /* Pasting into a plain-text field (labels, headings, roles) should not drag
     along the source document's markup. */
  document.addEventListener('paste', e => {
    if (!editMode) return;
    const field = e.target.closest?.('[contenteditable="true"]');
    if (!field) return;
    if (!field.dataset.plainText) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
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
    const link = navLinkFor(section.id);
    if (heading && link && link.textContent.trim() === heading.textContent.trim()) {
      heading.addEventListener('input', () => {
        link.textContent = heading.textContent.trim();
      });
    }
  }

  function enableNavEditing() {
    document.querySelectorAll('#sidebarNav .sidebar-link').forEach(link => {
      makeEditable(link, { plain: true, spellcheck: false });
      // Don't navigate away mid-edit.
      link.addEventListener('click', e => {
        if (editMode) e.preventDefault();
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
      await api.rpc('save_site', { payload });
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

  document.addEventListener('selectionchange', () => {
    if (!editMode || !toolbar) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      hideToolbar();
      return;
    }
    let node = selection.anchorNode;
    while (node && node.nodeType !== 1) node = node.parentNode;
    // Rich formatting only applies to the rich-text bodies.
    const body = node && node.closest('.content-body[contenteditable="true"]');
    if (!body) {
      hideToolbar();
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width) {
      hideToolbar();
      return;
    }
    showToolbarAt(rect);
  });

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
      else if (cmd === 'removeFormat') {
        document.execCommand('removeFormat');
        document.execCommand('formatBlock', false, 'p');
      } else document.execCommand(cmd);
    });
  }

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
    if (e.key === 'Escape') cancelChanges();
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
