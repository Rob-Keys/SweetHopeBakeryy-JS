// header.js - Inject site navigation header
// Replaces private/frontend/components/header.php

/**
 * Render the header into #header-placeholder.
 * Exact HTML from header.php.
 */
export function renderHeader() {
  const el = document.getElementById('header-placeholder');
  if (!el) return;

  // Prefetch likely next pages to reduce navigation latency.
  const prefetchRoutes = ['/', '/about', '/menu', '/contact'];
  const head = document.head;
  if (head) {
    prefetchRoutes.forEach((href) => {
      if (window.location.pathname === href) return;
      if (head.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = href;
      head.appendChild(link);
    });
  }

  el.innerHTML = `
    <header>
      <div style="height: 2.4rem; position: absolute; width: 100vw; background-color: #3f2a14;"></div>
      <nav class="navbar navbar-expand-lg p-1">
        <div class="container-fluid">
          <ul class="navbar-nav mx-auto mb-2 mb-lg-0 d-flex flex-row justify-content-evenly w-100">
            <li class="nav-item">
              <a class="nav-link text-light active" aria-current="page" href="/"><h5 class="p-0 m-0">Home</h5></a>
            </li>
            <li class="nav-item">
              <a class="nav-link text-light" href="/about"><h5 class="p-0 m-0">About Us</h5></a>
            </li>
            <li>
              <a class="nav-link text-light" href="/menu"><h5 class="p-0 m-0">Menu</h5></a>
            </li>
            <li class="nav-item">
              <a class="nav-link text-light" href="/contact"><h5 class="p-0 m-0">Contact</h5></a>
            </li>
          </ul>
          <a href="/" class="pe-2 float-end"><img class="navbar-brand" src="https://sweethopebakeryy.s3.us-east-1.amazonaws.com/header/sweethopebakeryy.avif" alt="Sweet Hope Bakery Logo"></a>
        </div>
      </nav>
    </header>
    <main>`;
}
