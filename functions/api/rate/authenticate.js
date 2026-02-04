// POST /api/rate/authenticate
// Rate limiting is enforced at the Cloudflare edge (WAF/rate limiting rules).
// Accepts raw password, hashes server-side, compares to ADMIN_PASSWORD_HASH, returns JWT
// Env vars: ADMIN_PASSWORD_HASH, JWT_SECRET

import { signJWT } from '../_jwt.js';

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function parsePbkdf2Hash(value) {
  const parts = String(value || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return null;
  return { iterations, saltB64: parts[2], hashB64: parts[3] };
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function hashPasswordPbkdf2(password, saltB64, iterations) {
  const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    256
  );
  return toBase64(derivedBits);
}

export async function onRequestPost(context) {
  const { ADMIN_PASSWORD_HASH, JWT_SECRET } = context.env;
  if (!ADMIN_PASSWORD_HASH) {
    return Response.json({ error: 'ADMIN_PASSWORD_HASH not set' }, { status: 500 });
  }
  if (!JWT_SECRET) {
    return Response.json({ error: 'JWT_SECRET not set' }, { status: 500 });
  }

  try {
    const parsed = parsePbkdf2Hash(ADMIN_PASSWORD_HASH);
    if (!parsed) {
      const parts = String(ADMIN_PASSWORD_HASH).split('$');
      return Response.json({ error: 'Hash parse failed', parts: parts.length, prefix: parts[0] }, { status: 500 });
    }

    const { password } = await context.request.json();
    const derived = await hashPasswordPbkdf2(password, parsed.saltB64, parsed.iterations);
    if (!timingSafeEqual(derived, parsed.hashB64)) {
      return Response.json({ error: 'Invalid password' }, { status: 401 });
    }

    const token = await signJWT({ sub: 'admin' }, JWT_SECRET);
    return Response.json({ token });
  } catch (err) {
    console.error('authenticate error:', err);
    return Response.json({ error: 'Internal error: ' + err.message }, { status: 500 });
  }
}
