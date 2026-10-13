import { renderHeader } from '/js/components/header.js';
import { renderFooter } from '/js/components/footer.js';
import { authenticate, getDesiredPage } from '/js/modules/auth.js';

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
            errorEl.textContent = result.status === 500
                ? 'Server configuration error. Please contact the administrator.'
                : result.status === 0
                    ? 'Could not reach the sign-in service. Please try again.'
                    : 'Incorrect password.';
            errorEl.style.display = 'block';
        }
    } catch {
        errorEl.textContent = 'Sign in could not be completed. Please try again.';
        errorEl.style.display = 'block';
    } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = originalLabel;
    }
});
