/* =============================================
   Staff sign-in

   A small dialog behind the "Staff login" link in the sidebar. Visitors never
   need it; staff use it to unlock the Edit button.
   ============================================= */
(function () {
  'use strict';

  const api = window.PCCApi;

  let dialog, form, emailInput, passwordInput, errorBox, submitButton;

  function build() {
    dialog = document.createElement('div');
    dialog.className = 'auth-modal';
    dialog.hidden = true;
    dialog.innerHTML = `
      <div class="auth-modal__backdrop" data-close="1"></div>
      <div class="auth-modal__panel" role="dialog" aria-modal="true"
           aria-labelledby="authTitle">
        <h2 id="authTitle">Staff sign-in</h2>
        <p class="auth-modal__hint">
          For worship staff only. Signing in lets you edit this handbook.
        </p>
        <form novalidate>
          <label for="authEmail">Email</label>
          <input id="authEmail" type="email" autocomplete="username" required>
          <label for="authPassword">Password</label>
          <input id="authPassword" type="password" autocomplete="current-password" required>
          <p class="auth-modal__error" role="alert" hidden></p>
          <div class="auth-modal__actions">
            <button type="button" class="auth-modal__cancel" data-close="1">Cancel</button>
            <button type="submit" class="auth-modal__submit">Sign in</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(dialog);

    form = dialog.querySelector('form');
    emailInput = dialog.querySelector('#authEmail');
    passwordInput = dialog.querySelector('#authPassword');
    errorBox = dialog.querySelector('.auth-modal__error');
    submitButton = dialog.querySelector('.auth-modal__submit');

    dialog.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) close();
    });
    form.addEventListener('submit', submit);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !dialog.hidden) close();
    });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function open() {
    if (!dialog) build();
    showError('');
    form.reset();
    dialog.hidden = false;
    document.body.classList.add('auth-open');
    emailInput.focus();
  }

  function close() {
    if (!dialog) return;
    dialog.hidden = true;
    document.body.classList.remove('auth-open');
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
      close();
      // If the page had fallen back to offline content, this pulls the live
      // copy now that we have a session.
      if (!window.PCCSite.isLive) await window.PCCSite.reload();
      window.PCCEditor?.showToast('Signed in — the Edit button is now available.');
    } catch (err) {
      showError(err.message || 'Sign-in failed. Please try again.');
      passwordInput.select();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = label;
    }
  }

  /* ── sidebar control ─────────────────────────────────────────────── */

  function syncControl() {
    const button = document.getElementById('adminToggle');
    if (!button) return;
    const signedIn = api.isSignedIn();
    button.textContent = signedIn ? 'Sign out' : 'Staff login';
    button.title = signedIn ? `Signed in as ${api.currentEmail()}` : 'Worship staff sign-in';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('adminToggle');
    if (!button) return;
    button.addEventListener('click', async () => {
      if (!api.isSignedIn()) {
        open();
        return;
      }
      if (window.PCCEditor?.isEditing() &&
          !confirm('You have unsaved changes. Sign out and discard them?')) {
        return;
      }
      await api.signOut();
      window.PCCEditor?.showToast('Signed out.');
    });
    syncControl();
  });

  window.addEventListener('pcc:auth', syncControl);
})();
