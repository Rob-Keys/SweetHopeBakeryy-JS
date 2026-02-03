// auth.js - Client-side admin authentication
// Replaces Controller.php:164-178 isAuthenticated()
// WARNING: Client-side auth is NOT secure. Placeholder until Lambda auth is implemented.

import config from './config.js';

const AUTH_KEY = 'shb_auth';
const DESIRED_PAGE_KEY = 'shb_desired_page';

/**
 * Hash a password using SHA-256 (mirrors PHP hash('sha256', $password))
 * @param {string} password
 * @returns {Promise<string>} hex-encoded hash
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Authenticate with a password. Stores hash in sessionStorage on success.
 * @param {string} password
 * @returns {Promise<boolean>}
 */
async function authenticate(password) {
  const hash = await hashPassword(password);
  if (hash === config.adminPasswordHash) {
    sessionStorage.setItem(AUTH_KEY, hash);
    return true;
  }
  return false;
}

/**
 * Check if the current session is authenticated.
 * @returns {boolean}
 */
function isAuthenticated() {
  return sessionStorage.getItem(AUTH_KEY) === config.adminPasswordHash;
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

export { authenticate, isAuthenticated, hashPassword, getDesiredPage, setDesiredPage };
