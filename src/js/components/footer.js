// footer.js - injects the site footer.

/**
 * Render the footer into #footer-placeholder.
 * Includes Bootstrap JS injection so components can rely on it.
 */
export function renderFooter() {
  const el = document.getElementById('footer-placeholder');
  if (!el) return;

  el.innerHTML = `
    </main>
    <footer class="d-flex align-items-center justify-content-between pt-2 ps-5 pe-5">
      <p>&copy; 2026 sweethopebakeryy ALL RIGHTS RESERVED</p>
      <p class="footer-socials"><i class="fa-brands fa-instagram"></i> Instagram: <a href="https://www.instagram.com/sweethopebakeryy/">@sweethopebakeryy </a> </p>
    </footer>`;

  // Load Bootstrap JS once for components that depend on it.
  if (!document.querySelector('script[src*="bootstrap.bundle.min.js"]')) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js';
    script.integrity = 'sha384-C6RzsynM9kWDrMNeT87bh95OGNyZPhcTNXj1NW7RuBCsyN/o0jlpcV8Qyq46cDfL';
    script.crossOrigin = 'anonymous';
    document.body.appendChild(script);
  }
}
