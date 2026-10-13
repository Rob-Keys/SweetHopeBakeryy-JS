export function showLoading(container, message = 'Loading…') {
  if (!container) return;
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = `<p class="page-status" role="status">${message}</p>`;
}

export function showError(container, message, retry) {
  if (!container) return;
  container.removeAttribute('aria-busy');
  container.innerHTML = `<div class="alert alert-warning" role="alert"><p>${message}</p><button type="button" class="btn btn-cookie" data-retry>Retry</button></div>`;
  container.querySelector('[data-retry]')?.addEventListener('click', retry, { once: true });
}

export function showReady(container) {
  container?.removeAttribute('aria-busy');
}
