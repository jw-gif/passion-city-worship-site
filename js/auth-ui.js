/* =============================================
   Staff sign-in

   Nothing here is public: signed out, the page is a sign-in form and nothing
   else. The gear in the corner is only a way back out again.

   This is the front door, not the lock. The lock is the read policy on the
   content tables (sql/private-content.sql) — without that, the content is
   readable straight from the API whatever this file draws.
   ============================================= */
(function () {
  'use strict';

  const api = window.PCCApi;

  let lock, form, emailInput, passwordInput, errorBox, submitButton;

  function build() {
    lock = document.createElement('div');
    lock.className = 'auth-lock';
    lock.id = 'authLock';
    lock.innerHTML = `
      <div class="auth-lock__panel" role="dialog" aria-modal="true"
           aria-labelledby="authTitle">
        <span class="sidebar-logo__org">Passion City Church</span>
        <!-- On staging this is the only marker visible before signing in,
             since the sidebar that usually carries it is hidden. -->
        <span class="env-badge">Staging</span>
        <h1 id="authTitle">Worship Team</h1>
        <p class="auth-lock__hint">
          This handbook is for the worship team. Sign in to read it.
        </p>
        <form novalidate>
          <label for="authEmail">Email</label>
          <input id="authEmail" type="email" autocomplete="username" required>
          <label for="authPassword">Password</label>
          <input id="authPassword" type="password" autocomplete="current-password" required>
          <p class="auth-modal__error" role="alert" hidden></p>
          <div class="auth-lock__actions">
            <button type="submit" class="auth-modal__submit">Sign in</button>
          </div>
        </form>
        <p class="auth-lock__foot">
          Trouble getting in? Email
          <a href="mailto:worship@passioncitychurch.com">worship@passioncitychurch.com</a>.
        </p>
      </div>`;
    document.body.appendChild(lock);

    form = lock.querySelector('form');
    emailInput = lock.querySelector('#authEmail');
    passwordInput = lock.querySelector('#authPassword');
    errorBox = lock.querySelector('.auth-modal__error');
    submitButton = lock.querySelector('.auth-modal__submit');

    form.addEventListener('submit', submit);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  /** Locked or not, decided only by whether there is a session. */
  function applyLock() {
    const locked = !api.isSignedIn();
    document.body.classList.toggle('is-locked', locked);
    if (!locked) {
      if (lock) lock.hidden = true;
      return;
    }
    if (!lock) build();
    lock.hidden = false;
    showError('');
    form.reset();
  }

  async function submit(e) {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError('Please enter both your email and password.');
      return;
    }

    submitButton.disabled = true;
    const label = submitButton.textContent;
    submitButton.textContent = 'Signing in…';
    showError('');

    try {
      await api.signIn(email, password);
      // The pcc:auth event unlocks the page and loads the content.
    } catch (err) {
      showError(err.message || 'Sign-in failed. Please try again.');
      passwordInput.select();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = label;
    }
  }

  /* ── sign-out gear ───────────────────────────────────────────────── */

  function syncControl() {
    const button = document.getElementById('adminToggle');
    if (!button) return;
    const signedIn = api.isSignedIn();
    // Signed out there is nothing for it to do — the form has the page.
    button.hidden = !signedIn;
    // The gear's label, not its contents — writing textContent here would
    // delete the SVG.
    const label = `Sign out (${api.currentEmail()})`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.classList.toggle('is-signed-in', signedIn);
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLock();
    const button = document.getElementById('adminToggle');
    if (button) {
      button.addEventListener('click', async () => {
        if (!api.isSignedIn()) return;
        if (window.PCCEditor?.isEditing() &&
            !confirm('You have unsaved changes. Sign out and discard them?')) {
          return;
        }
        await api.signOut();
      });
    }
    syncControl();
  });

  window.addEventListener('pcc:auth', () => {
    applyLock();
    syncControl();
    if (api.isSignedIn()) emailInput && (emailInput.value = '');
  });

  // Lock immediately, before anything renders, if there is no session at all.
  if (!api.isSignedIn()) document.body.classList.add('is-locked');
})();
