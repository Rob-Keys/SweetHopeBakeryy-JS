import { renderHeader } from '/js/components/header.js';
import { renderFooter } from '/js/components/footer.js';
import { authenticate, getDesiredPage } from '/js/modules/auth.js';

renderHeader();
renderFooter();

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const result = await authenticate(password);
    if (result.success) {
        window.location.href = getDesiredPage();
    } else {
        const errorEl = document.getElementById('auth-error');
        if (result.status === 500) {
            errorEl.textContent = 'Server configuration error. Please contact the administrator.';
        } else {
            errorEl.textContent = 'Incorrect password.';
        }
        errorEl.style.display = 'block';
    }
});
