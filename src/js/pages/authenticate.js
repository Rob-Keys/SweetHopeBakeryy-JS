import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { authenticate, getDesiredPage } from '../modules/auth.js';

renderHeader();
renderFooter();

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const button = e.currentTarget.querySelector('[type="submit"]');
    const errorEl = document.getElementById('auth-error');
    const originalLabel = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Signing in…';
    errorEl.style.display = 'none';
    try {
        const result = await authenticate(password);
        if (result.success) {
            window.location.href = getDesiredPage();
        } else {
            errorEl.textContent = result.status === 401
                ? 'Incorrect password.'
                : result.error || `Sign-in failed (HTTP ${result.status || 'unknown'}).`;
            errorEl.style.display = 'block';
        }
    } catch (error) {
        errorEl.textContent = `Sign-in failed: ${error.message || String(error)}`;
        errorEl.style.display = 'block';
    } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = originalLabel;
    }
});
