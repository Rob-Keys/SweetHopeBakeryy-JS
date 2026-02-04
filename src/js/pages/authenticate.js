import { renderHeader } from '/js/components/header.js';
import { renderFooter } from '/js/components/footer.js';
import { authenticate, getDesiredPage } from '/js/modules/auth.js';

renderHeader();
renderFooter();

document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    const success = await authenticate(password);
    if (success) {
        window.location.href = getDesiredPage();
    } else {
        document.getElementById('auth-error').style.display = 'block';
    }
});
