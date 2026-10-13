// customize-page.js - renders the admin page section editor.

/**
 * Render the page section editor for a given page.
 * @param {Array} sections - Array of { sectionIndex, headerText, bodyText, imageURL }
 * @param {string} pageName - 'home_page', 'about_page', or 'contact_page'
 * @returns {string} HTML string
 */
import { escapeHtml } from '../modules/escape.js';

const safe = (value) => escapeHtml(value == null ? '' : String(value));

function previewImage(url, alt, className = '') {
  if (!url) {
    return `<div class="site-preview-image-empty" aria-label="No image currently set"><i class="fa-regular fa-image" aria-hidden="true"></i><span>No image set</span></div>`;
  }
  return `<img class="${className}" src="${safe(url)}" alt="${safe(alt)}" loading="lazy" decoding="async">`;
}

/**
 * Render a read-only overview of the public site using the current editable data.
 * Static copy and components mirror the public page templates.
 */
export function renderSitePreview(products, homeSections, aboutSections, contactSections) {
  const home = [...homeSections].sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));
  const about = [...aboutSections].sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));
  const contact = [...contactSections].sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  const homeRows = home.length
    ? home.map((section, index) => `
        <article class="site-preview-story ${index % 2 ? 'is-reversed' : ''}">
          <div>${previewImage(section.imageURLs?.[0], section.bodyText || 'Bakery story image')}</div>
          <div class="site-preview-story-copy"><h3>${safe(section.bodyText || '')}</h3><a href="/menu" class="btn btn-cookie">Order Now</a></div>
        </article>`).join('')
    : '<p class="site-preview-empty">Add a Home page section below to see it here.</p>';

  const productCards = products.length
    ? products.map((product) => {
        const image = product.imageURLs?.[0] || '';
        const extraImages = (product.imageURLs || []).slice(1);
        const priceOptions = Object.entries(product.prices || {}).sort(([a], [b]) => Number(a) - Number(b));
        return `
          <article class="site-preview-product">
            ${previewImage(image, `${product.itemName || 'Bakery'} picture`, 'site-preview-product-image')}
            ${extraImages.length ? `<div class="site-preview-product-thumbnails">${extraImages.map((url, index) => previewImage(url, `${product.itemName || 'Bakery'} picture ${index + 2}`)).join('')}</div>` : ''}
            <div class="site-preview-product-copy"><h3>${safe(product.itemName)}</h3>
              ${product.description ? `<p>${safe(product.description)}</p>` : ''}
              ${priceOptions.length ? `<p class="site-preview-prices">${priceOptions.map(([qty, price]) => `<span>${safe(qty)} for $${Number(price).toFixed(2)}</span>`).join('')}</p>` : '<p class="site-preview-empty">No price options set.</p>'}
              <label>Quantity: <select disabled aria-label="Preview quantity">${priceOptions.length ? priceOptions.map(([qty, price]) => `<option value="${safe(qty)}_${Number(price)}">${safe(qty)} for $${Number(price).toFixed(2)}</option>`).join('') : '<option>No price options</option>'}</select></label>
              <button type="button" class="btn btn-cookie" disabled>Add to Cart</button>
            </div>
          </article>`;
      }).join('')
    : '<p class="site-preview-empty">No menu items yet.</p>';

  const aboutRows = about.length
    ? about.map((section, index) => `
        <article class="site-preview-about-row ${index % 2 ? '' : 'is-reversed'}">
          <div>${previewImage(section.imageURLs?.[0], section.headerText || 'About Sweet Hope Bakery', 'site-preview-about-image')}</div>
          <div><h3>${safe(section.headerText || '')}</h3><p>${safe(section.bodyText || '')}</p></div>
        </article>`).join('')
    : '<p class="site-preview-empty">Add an About Us section below to see it here.</p>';

  const contactIntro = contact[0];
  const email = contact[1];
  const instagram = contact[2];
  const contactExtras = contact.slice(3).map(section => `
    <article class="site-preview-contact-extra">${section.headerText ? `<h3>${safe(section.headerText)}</h3>` : ''}${section.bodyText ? `<p>${safe(section.bodyText)}</p>` : ''}</article>`).join('');

  return `
    <section class="site-preview" aria-labelledby="site-preview-title">
      <div class="site-preview-heading">
        <div><p class="site-preview-kicker">A visual guide to the public pages</p><h2 id="site-preview-title">Site preview</h2></div>
        <p>Live content below comes from the records you edit on this page. Preview buttons and form fields are inactive.</p>
      </div>

      <section class="site-preview-page">
        <div class="site-preview-label"><span>Shared site header</span><a href="/" target="_blank" rel="noopener">Open Home ↗</a></div>
        <div class="site-preview-nav"><nav aria-label="Preview navigation"><a href="/">Home</a><a href="/about">About Us</a><a href="/menu">Menu</a><a href="/contact">Contact</a></nav><img src="https://sweethopebakeryy.s3.us-east-1.amazonaws.com/header/sweethopebakeryy.avif" alt="Sweet Hope Bakery Logo" loading="lazy"></div>
        <div class="site-preview-hero"><div class="site-preview-hero-images" aria-hidden="true"><img src="/images/left.avif" alt=""><img src="/images/middle.avif" alt=""><img src="/images/right.avif" alt=""></div><p class="site-preview-kicker">Made-To-Order Baking in Fairfax, VA</p><h1>Sweet Hope Bakery</h1><a href="/menu" class="btn btn-invert-cookie desktop-button">Order Now</a></div>
        <div class="site-preview-home-tagline">World Class Baking Since 2002</div>
        <div class="site-preview-mobile-cta"><a href="/menu" class="btn btn-cookie mobile-button">Order Now</a></div>
        <div class="site-preview-section-head"><span>Home page sections</span><small>Current content · editable below</small></div>
        <div class="site-preview-stories">${homeRows}</div>
      </section>

      <section class="site-preview-page">
        <div class="site-preview-label"><span>Menu</span><a href="/menu" target="_blank" rel="noopener">Open Menu ↗</a></div>
        <div class="site-preview-section-head"><span>Menu products · current records</span><small>Editable below</small></div>
        <div class="site-preview-products">${productCards}</div>
        <aside class="site-preview-cart"><div><i class="fa-solid fa-basket-shopping" aria-hidden="true"></i><h3>Your Cart</h3><p class="site-preview-muted">Currently Empty</p></div><div><strong>Total: $0.00</strong><div class="site-preview-cart-buttons"><button type="button" disabled class="btn btn-primary">Checkout</button><button type="button" disabled class="btn btn-outline-secondary">Clear Cart</button></div></div></aside>
      </section>

      <section class="site-preview-page">
        <div class="site-preview-label"><span>About Us</span><a href="/about" target="_blank" rel="noopener">Open About ↗</a></div>
        <div class="site-preview-section-head"><span>About page sections · current records</span><small>Editable below</small></div>
        <div class="site-preview-about">${aboutRows}</div>
        <article class="site-preview-rob"><img src="/images/about/rob.avif" alt="Rob, Web Developer" loading="lazy"><div><h2>Meet Rob</h2><p>Caroline's brother Rob is the tech brain behind Sweet Hope Bakery's online home. He designed and developed this site to give you a seamless ordering experience—so you can focus on enjoying the pastries, not the click-throughs.</p></div></article>
      </section>

      <section class="site-preview-page">
        <div class="site-preview-label"><span>Contact</span><a href="/contact" target="_blank" rel="noopener">Open Contact ↗</a></div>
        <div class="site-preview-contact">
          ${contactIntro ? `<h2>${safe(contactIntro.headerText || '')}</h2><p class="site-preview-contact-description">${safe(contactIntro.bodyText || '')}</p>` : '<p class="site-preview-empty">Contact intro is not set.</p>'}
          <div class="site-preview-contact-info">
            ${email ? `<p><strong>${safe(email.headerText)}:</strong> <a href="mailto:${safe(email.bodyText)}">${safe(email.bodyText)}</a></p>` : '<p class="site-preview-empty">Email contact record is not set.</p>'}
            ${instagram ? `<p><strong>${safe(instagram.headerText)}:</strong> <a href="https://www.instagram.com/sweethopebakeryy/" target="_blank" rel="noopener">${safe(instagram.bodyText)} <i class="fa-brands fa-instagram" aria-hidden="true"></i></a></p>` : '<p class="site-preview-empty">Instagram contact record is not set.</p>'}
          </div>${contactExtras}
        </div>
      </section>

      <section class="site-preview-page">
        <div class="site-preview-label"><span>Checkout</span><a href="/menu" target="_blank" rel="noopener">Start an order ↗</a></div>
        <div class="site-preview-section-head"><span>Checkout layout</span><small>Form controls shown for context; inactive in preview</small></div>
        <div class="site-preview-checkout"><article><h3>Order Summary</h3><p class="site-preview-muted">Items from your cart appear here</p><strong>Total: $0.00</strong></article><article class="site-preview-checkout-form"><h3>Pickup Details</h3><label>Name<input type="text" placeholder="Name" disabled></label><label>Email<input type="email" placeholder="Email" disabled></label><label>Phone Number<input type="tel" placeholder="Phone Number" disabled></label><p>Pickup Location: <strong>Arlington, VA, 22207</strong></p><label>Pickup Date<input type="date" disabled></label><p class="site-preview-muted">* Final pickup time and address to be coordinated through direct communication post-order.</p><h3>Payment Method</h3><div class="site-preview-payment-placeholder">Payment form</div><button type="button" class="btn btn-cookie" disabled>Pay Now</button></article></div>
        <article class="site-preview-order-success"><h2>Thanks for your order!</h2><h4>A confirmation has been sent to your email.</h4><div class="alert alert-success mt-3" role="alert"><strong>Payment successful!</strong> We will contact you to coordinate pickup details.</div></article>
      </section>

      <footer class="site-preview-footer"><span>© 2026 sweethopebakeryy ALL RIGHTS RESERVED</span><span><i class="fa-brands fa-instagram" aria-hidden="true"></i> Instagram: <a href="https://www.instagram.com/sweethopebakeryy/" target="_blank" rel="noopener">@sweethopebakeryy</a></span></footer>
    </section>`;
}

export function renderLocalCodeAgentPanel() {
  return `
    <section class="local-code-agent" aria-labelledby="local-code-agent-title">
      <div class="local-code-agent-copy">
        <h2 id="local-code-agent-title">Agentic Customization</h2>
        <p>Ask questions about the site or describe a change you’d like. Luna can take it from there and handle your request autonomously.</p>
        <p class="local-agent-connection"><span class="local-agent-indicator" aria-hidden="true"></span><span data-agent-connection>Checking Luna's availability…</span></p>
      </div>
      <form class="local-code-agent-form" id="local-code-agent-form">
        <label for="local-code-agent-prompt">Your message</label>
        <textarea id="local-code-agent-prompt" name="prompt" rows="5" maxlength="12000" placeholder="For example: Add an FAQ accordion to the Contact page with keyboard accessible controls." required disabled></textarea>
        <div class="local-code-agent-actions"><button class="btn btn-cookie" type="submit" data-agent-submit disabled>Send to Luna</button></div>
        <div class="local-agent-history" data-agent-history aria-label="Recent Luna requests"></div>
        <div class="local-agent-task" data-agent-task aria-live="polite" hidden></div>
      </form>
    </section>`;
}

export function renderPageSectionEditor(sections, pageName) {
  const displayName = pageName.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const showHeader = pageName !== 'home_page';
  const showImage = pageName !== 'contact_page';
  const bodyColClass = pageName === 'about_page' ? 'col-4' : 'col-6';
  const editBodyColClass = pageName === 'home_page' ? 'col-4' : 'col-6';

  // Table header.
  let html = `
    <div class="m-5">
      <h2 class="subtitle">Edit ${displayName} Content</h2>
      <div class="row menu-row">
        <div class="col-2"><h5>Section Index</h5></div>`;

  if (showHeader) {
    html += `<div class="col-2"><h5>Header Text</h5></div>`;
  }
  html += `<div class="${bodyColClass}"><h5>Body Text</h5></div>`;
  if (showImage) {
    html += `<div class="col-2"><h5>Image URL</h5></div>`;
  }
  html += `<div class="col-2 right-align"><h5>Actions</h5></div>
      </div>`;

  // Existing sections.
  sections.forEach((section, i) => {
    const isRequiredContactSection = pageName === 'contact_page' && i < 3;
    const safeSectionIndex = escapeHtml(section.sectionIndex);
    const safeHeaderText = escapeHtml(section.headerText || '');
    const safeBodyText = escapeHtml(section.bodyText || '');
    const imageURL = section.imageURL || (section.imageURLs ? section.imageURLs[0] : '');
    const safeImageUrl = escapeHtml(imageURL);
    const safeImageUrlsJson = escapeHtml(JSON.stringify(section.imageURLs || []));
    html += `
      <div class="row menu-row" data-section-index="${i}" data-page-name="${pageName}" data-image-urls='${safeImageUrlsJson}'>
        <!-- View Mode -->
        <div class="col-2 view-mode"><p>${safeSectionIndex}</p></div>`;

    if (showHeader) {
      html += `<div class="col-2 view-mode"><p>${safeHeaderText}</p></div>`;
    }
    html += `<div class="${bodyColClass} view-mode"><p>${safeBodyText}</p></div>`;

    // Edit mode markup.
    html += `
        <div class="col-2 edit-mode" style="display: none;">
          <textarea class="form-control edit-sectionIndex" rows="2" disabled>${safeSectionIndex}</textarea>
          <input type="hidden" class="original-sectionIndex" value="${safeSectionIndex}">
        </div>`;

    if (showHeader) {
      html += `
        <div class="col-2 edit-mode" style="display: none;">
          <textarea class="form-control edit-headerText" rows="2">${safeHeaderText}</textarea>
        </div>`;
    }
    html += `
        <div class="${editBodyColClass} edit-mode" style="display: none;">
          <textarea class="form-control edit-bodyText" rows="4">${safeBodyText}</textarea>
        </div>`;

    if (showImage) {
      html += `
        <div class="col-2">
          <div class="view-mode">
            <img class="demo-photo" src="${safeImageUrl}" alt="Section's associated image" loading="lazy" decoding="async">
          </div>
          <div class="edit-mode" style="display: none;">
            <div class="edit-images-container">
              <div class="edit-image-item" data-image-url="${safeImageUrl}">
                <img src="${safeImageUrl}" alt="Section image" class="edit-product-image" style="width: 80px; height: 80px; object-fit: cover;" loading="lazy" decoding="async">
                <button type="button" class="btn btn-sm btn-danger remove-image-btn">&times;</button>
              </div>
            </div>
            <input type="file" class="form-control mt-2 add-images-input" accept="image/*">
            <small class="text-muted">Replace image</small>
          </div>
        </div>`;
    }

    html += `
        <div class="col-2 right-align">
          <button type="button" class="btn btn-cookie button-2 mt-2 edit-section-btn">Edit Section</button>
          <button type="button" class="btn btn-success button-2 mt-2 save-section-btn" style="display: none;">Save Edits</button>
          <form class="remove-section-form">
            <input type="hidden" name="tableName" value="${pageName}">
            <input type="hidden" name="partitionKey" value="sectionIndex">
            <input type="hidden" name="partitionKeyValue" value="${safeSectionIndex}">
            ${isRequiredContactSection
              ? '<button type="button" class="btn btn-secondary button-2 mt-2" disabled title="Required for the contact page layout">Required Section</button>'
              : '<button type="submit" class="btn btn-danger button-2 mt-2">Remove Section</button>'}
          </form>
        </div>
      </div>`;
  });

  // Add-section form.
  html += `
    <form class="row menu-row add-section-form" data-page-name="${pageName}">
      <div class="col-2">
        <input type="number" name="partitionKeyValue" placeholder="Section Index" min="${pageName === 'contact_page' ? '3' : '0'}" step="1" required>
      </div>`;

  if (showHeader) {
    html += `
      <div class="col-2">
        <textarea rows="2" name="headerText" placeholder="Header text"></textarea>
      </div>`;
  }
  html += `
      <div class="${bodyColClass}">
        <textarea rows="4" name="bodyText" placeholder="Body text"></textarea>
      </div>`;

  if (showImage) {
    html += `
      <div class="col-2">
        <input type="file" name="images[]">
      </div>`;
  }

  html += `
      <div class="col-2 right-align">
        <input type="hidden" name="tableName" value="${pageName}">
        <input type="hidden" name="partitionKey" value="sectionIndex">
        <button type="submit" class="btn btn-cookie button-2 mt-2">Add Section</button>
      </div>
    </form>
  </div>`;

  return html;
}
