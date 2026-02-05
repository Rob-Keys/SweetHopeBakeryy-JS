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

export function initFadeEffects() {
  const elements = document.querySelectorAll('.fade-in-up, .fade-in-right, .fade-in-left');
  if (!elements.length) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach((el) => el.classList.add('fade-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle('fade-visible', entry.isIntersecting);
    });
  }, {
    threshold: 0.2
  });

  const startObserving = () => {
    elements.forEach((el) => observer.observe(el));
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(startObserving));
  } else {
    startObserving();
  }
}

export function initShared() {
  initImageSliders();
  initFadeEffects();
}
