// shared.js - shared UI behavior (image slider, scroll fade-in effects).
// Call initShared() after dynamic content is injected into the DOM.

const originalConsole = {
  log: console.log?.bind(console),
  warn: console.warn?.bind(console),
  error: console.error?.bind(console)
};

function debugLog(...args) {
  if (globalThis.__debugErrors !== true) return;
  if (originalConsole.error) {
    originalConsole.error(...args);
  }
}

globalThis.__debugLog = debugLog;

function setConsoleEnabled(enabled) {
  if (typeof console === 'undefined') return;
  const noop = () => {};
  try {
    if (enabled) {
      if (originalConsole.log) console.log = originalConsole.log;
      if (originalConsole.warn) console.warn = originalConsole.warn;
      if (originalConsole.error) console.error = originalConsole.error;
    } else {
      console.log = noop;
      console.warn = noop;
      console.error = noop;
    }
  } catch {
    // Best-effort: console may be read-only in some environments.
  }
}

async function applyConsoleGate() {
  // Disable logs by default; enable only when the server allows it.
  setConsoleEnabled(false);
  try {
    globalThis.__debugErrors = false;
  } catch {
    // Best-effort: globalThis may be read-only in some environments.
  }
  try {
    const response = await fetch('/api/public/get-debug-flags');
    if (!response.ok) return;
    const data = await response.json();
    if (data?.debugErrors === true) {
      setConsoleEnabled(true);
      try {
        globalThis.__debugErrors = true;
      } catch {
        // Best-effort: globalThis may be read-only in some environments.
      }
    }
  } catch {
    // Never surface debug-gating failures to end users.
  }
}

applyConsoleGate();

export class ImageSlider {
  constructor(containerSelector) {
    this.container = typeof containerSelector === 'string'
      ? document.querySelector(containerSelector)
      : containerSelector;
    this.wrapper = this.container.querySelector('.slider-wrapper');
    this.slides = this.container.querySelectorAll('.slide');
    this.leftArrow = this.container.querySelector('.arrow.left');
    this.rightArrow = this.container.querySelector('.arrow.right');

    this.currentIndex = 0;
    this.totalSlides = this.slides.length;

    this.init();
  }

  init() {
    if (this.leftArrow && this.rightArrow) {
      this.leftArrow.addEventListener('click', () => this.prevSlide());
      this.rightArrow.addEventListener('click', () => this.nextSlide());
    }

    // Basic touch swipe support.
    this.touchStartX = 0;
    this.touchEndX = 0;

    this.container.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
    });

    this.container.addEventListener('touchend', (e) => {
      this.touchEndX = e.changedTouches[0].screenX;
      this.handleSwipe();
    });
  }

  handleSwipe() {
    const swipeThreshold = 50;
    const diff = this.touchStartX - this.touchEndX;

    if (Math.abs(diff) > swipeThreshold) {
      if (diff > 0) {
        this.nextSlide();
      } else {
        this.prevSlide();
      }
    }
  }

  updateSlider() {
    const offset = -this.currentIndex * 100;
    this.wrapper.style.transform = `translateX(${offset}%)`;
  }

  nextSlide() {
    this.currentIndex = (this.currentIndex + 1) % this.totalSlides;
    this.updateSlider();
  }

  prevSlide() {
    this.currentIndex = (this.currentIndex - 1 + this.totalSlides) % this.totalSlides;
    this.updateSlider();
  }
}

export function initImageSliders() {
  const sliders = document.querySelectorAll('.slider-container');
  sliders.forEach(slider => {
    new ImageSlider(slider);
  });
}

const fadeSelector = '.fade-in-up, .fade-in-right, .fade-in-left';
const essentialContentSelector = 'h1, h2, h3, nav, form, button, .btn, a[href]';
const initializedFades = new WeakSet();
const pendingFades = new Set();
const fadeMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let fadeObserver;

fadeMotionQuery?.addEventListener?.('change', (event) => {
  if (!event.matches) return;
  // Cancel current entrances without replaying them when motion is re-enabled.
  document.querySelectorAll(fadeSelector).forEach((element) => {
    element.classList.remove('fade-visible');
  });
});

function canFade(element) {
  // Product cards intentionally animate as a unit, including their purchase form.
  if (element.matches('.product-card')) return true;
  return !element.matches(essentialContentSelector) &&
    !element.querySelector(essentialContentSelector);
}

export function initFadeEffects() {
  // A rerender can detach targets before they ever intersect.
  pendingFades.forEach((element) => {
    if (!element.isConnected) {
      fadeObserver.unobserve(element);
      pendingFades.delete(element);
    }
  });
  const elements = [...document.querySelectorAll(fadeSelector)]
    .filter((element) => !initializedFades.has(element) && canFade(element));
  if (!elements.length) return;

  // Fades enhance visible content; unavailable observers must never hide it.
  if (typeof IntersectionObserver !== 'function') return;

  if (!fadeObserver) {
    fadeObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.target.isConnected || entry.isIntersecting) {
          fadeObserver.unobserve(entry.target);
          pendingFades.delete(entry.target);
          // Async rendering may have added controls since registration.
          if (entry.target.isConnected && canFade(entry.target) && !fadeMotionQuery?.matches) {
            entry.target.classList.add('fade-visible');
          }
        }
      });
    }, {
      threshold: 0,
      rootMargin: '80px 0px'
    });
  }

  elements.forEach((element) => {
    initializedFades.add(element);
    pendingFades.add(element);
    fadeObserver.observe(element);
  });
}

export function initShared() {
  initImageSliders();
  initFadeEffects();
}
