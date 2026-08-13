/* =============================================
   Staff sign-in

   One form, doing two jobs. On the handbook, which anyone on the team can
   read, it is a dialog the gear opens when someone wants to edit. On the
   staff-only addresses — /home and the copies — it is the page itself until
   there is a session.

   Either way this is the front door, not the lock. The lock is the read
   policy on the tables (sql/public-handbook.sql): without it the copies are
   readable straight from the API whatever this file draws.
   ============================================= */
(function () {
  'use strict';

  const api = window.PCCApi;
  const gated = () => !window.PCCEnv || window.PCCEnv.requiresSignIn();

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
        <p class="auth-lock__hint" id="authHint"></p>
        <form novalidate>
          <label for="authEmail">Email</label>
          <input id="authEmail" type="email" autocomplete="username" required>
          <label for="authPassword">Password</label>
          <input id="authPassword" type="password" autocomplete="current-password" required>
          <p class="auth-modal__error" role="alert" hidden></p>
          <div class="auth-lock__actions">
            <button type="submit" class="auth-modal__submit">Sign in</button>
            <button type="button" class="auth-lock__cancel" hidden>Back to the handbook</button>
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
    lock.querySelector('.auth-lock__cancel').addEventListener('click', hide);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && lock && !lock.hidden && !gated()) hide();
    });
  }

  /** Close the form. Only ever possible where the page does not need it. */
  function hide() {
    if (!lock || gated()) return;
    lock.hidden = true;
    document.body.classList.remove('is-locked');
  }

  /** Open the form: as the page on a gated address, as a dialog otherwise. */
  function show() {
    if (!lock) build();
    const asGate = gated();
    lock.classList.toggle('auth-lock--dialog', !asGate);
    lock.querySelector('.auth-lock__cancel').hidden = asGate;
    lock.querySelector('#authHint').textContent = asGate
      ? 'This page is for the worship team. Sign in to see it.'
      : 'Sign in to edit the handbook. Reading it needs no account.';
    lock.hidden = false;
    document.body.classList.toggle('is-locked', asGate);
    showError('');
    form.reset();
    emailInput.focus({ preventScroll: true });
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  /** A gated address with no session shows the form and nothing else. */
  function applyLock() {
    if (api.isSignedIn() || !gated()) {
      document.body.classList.remove('is-locked');
      if (lock) lock.hidden = true;
      return;
    }
    show();
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
    // On a gated page the form already has the screen; there it would be a
    // button to nowhere.
    button.hidden = !signedIn && gated();
    // The gear's label, not its contents — writing textContent here would
    // delete the SVG.
    const label = signedIn ? `Sign out (${api.currentEmail()})` : 'Staff sign-in';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.classList.toggle('is-signed-in', signedIn);
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLock();
    const button = document.getElementById('adminToggle');
    if (button) {
      button.addEventListener('click', async () => {
        if (!api.isSignedIn()) {
          show(); // open page: the gear is how staff get in
          return;
        }
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
    if (api.isSignedIn() && lock) {
      lock.hidden = true;
      document.body.classList.remove('is-locked');
      emailInput.value = '';
    } else {
      applyLock();
    }
    syncControl();
  });
})();
