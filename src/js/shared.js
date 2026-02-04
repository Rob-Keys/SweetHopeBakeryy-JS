// shared.js - ImageSlider class + fade-in scroll effects
// Adapted from public/js/shared.js as an ES6 module
// Must call initShared() AFTER all dynamic content is in the DOM.

const originalConsole = {
  log: console.log?.bind(console),
  warn: console.warn?.bind(console),
  error: console.error?.bind(console)
};

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
    // ignore if console is not writable
  }
}

async function applyConsoleGate() {
  // Default to hiding logs unless server says otherwise
  setConsoleEnabled(false);
  try {
    globalThis.__debugErrors = false;
  } catch {
    // ignore if globalThis is not writable
  }
  try {
    const response = await fetch('/api/rate/get-debug-flags');
    if (!response.ok) return;
    const data = await response.json();
    if (data?.debugErrors === true) {
      setConsoleEnabled(true);
      try {
        globalThis.__debugErrors = true;
      } catch {
        // ignore if globalThis is not writable
      }
    }
  } catch {
    // swallow any errors to avoid leaking internals
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

    // Touch support
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

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('fade-visible');
      }
    });
  }, {
    threshold: 0.2
  });

  elements.forEach(el => observer.observe(el));
}

export function initShared() {
  initImageSliders();
  initFadeEffects();
}
