'use strict';

/** Click (or Enter on) a link row to copy its tracking URL. */
(function () {
  function flash(row) {
    row.classList.add('copied');
    const hint = row.querySelector('.copy-hint');
    const original = hint ? hint.textContent : null;
    if (hint) hint.textContent = 'Copied';
    setTimeout(function () {
      row.classList.remove('copied');
      if (hint && original !== null) hint.textContent = original;
    }, 1400);
  }

  async function copy(text) {
    // navigator.clipboard needs a secure context, which plain http://<lan-ip>
    // is not — fall back so this still works when testing from a phone.
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch { /* fall through */ }
    }
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(scratch);
    return ok;
  }

  document.addEventListener('click', function (event) {
    const row = event.target.closest('[data-copy]');
    if (row) copy(row.dataset.copy).then(function (ok) { if (ok) flash(row); });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest && event.target.closest('[data-copy]');
    if (!row) return;
    event.preventDefault();
    copy(row.dataset.copy).then(function (ok) { if (ok) flash(row); });
  });
})();
