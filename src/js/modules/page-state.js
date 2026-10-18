export function showLoading(container, message = 'Loading…') {
  if (!container) return;
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = `<p class="page-status" role="status">${message}</p>`;
}

export function showError(container, message, retry) {
  if (!container) return;
  container.removeAttribute('aria-busy');
  const alert = document.createElement('div');
  alert.className = 'alert alert-warning';
  alert.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-cookie';
  button.dataset.retry = '';
  button.textContent = 'Retry';
  alert.append(text, button);
  container.replaceChildren(alert);
  container.querySelector('[data-retry]')?.addEventListener('click', retry, { once: true });
}

export function showReady(container) {
  container?.removeAttribute('aria-busy');
}
