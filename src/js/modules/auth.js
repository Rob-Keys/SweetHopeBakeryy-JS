// auth.js - Client-side admin authentication via JWT
// POSTs password to /api/rate/authenticate, stores JWT in sessionStorage

const AUTH_KEY = 'shb_auth';
const DESIRED_PAGE_KEY = 'shb_desired_page';

/**
 * Authenticate with a password via server endpoint. Stores JWT in sessionStorage on success.
 * @param {string} password
 * @returns {Promise<boolean>}
 */
async function authenticate(password) {
  try {
    const response = await fetch('/api/rate/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!response.ok) return false;
    const { token } = await response.json();
    if (token) {
      sessionStorage.setItem(AUTH_KEY, token);
      return true;
    }
    return false;
  } catch (err) {
    console.error('authenticate failed:', err);
    return false;
  }
}

/**
 * Check if the current session has a JWT token.
 * @returns {boolean}
 */
function isAuthenticated() {
  return !!sessionStorage.getItem(AUTH_KEY);
}

/**
 * Get the JWT token for API calls.
 * @returns {string|null}
 */
function getAuthToken() {
  return sessionStorage.getItem(AUTH_KEY);
}

/**
 * Clear the auth token (logout).
 */
function clearAuth() {
  sessionStorage.removeItem(AUTH_KEY);
}

/**
 * Set the page to redirect to after authentication.
 * @param {string} page - URL path like '/customize' or '/mail'
 */
function setDesiredPage(page) {
  sessionStorage.setItem(DESIRED_PAGE_KEY, page);
}

/**
 * Get the page to redirect to after authentication (defaults to '/mail').
 * @returns {string}
 */
function getDesiredPage() {
  return sessionStorage.getItem(DESIRED_PAGE_KEY) || '/mail';
}

/**
 * Handle a 401 response by clearing auth and redirecting to login.
 * Call this when an admin API call returns HTTP 401 (expired/invalid token).
 */
function handle401() {
  clearAuth();
  setDesiredPage(window.location.pathname);
  window.location.href = '/authenticate';
}

export { authenticate, isAuthenticated, getAuthToken, clearAuth, getDesiredPage, setDesiredPage, handle401 };
