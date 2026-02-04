// JWT helper — sign and verify tokens using Web Crypto API (HMAC-SHA-256)
// No npm dependencies — uses native Cloudflare Workers runtime APIs

function base64urlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getSigningKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Sign a JWT with HMAC-SHA-256.
 * @param {Object} payload - claims (e.g., { sub: "admin" })
 * @param {string} secret - HMAC signing secret
 * @param {number} expiresInSeconds - token lifetime (default 24 hours)
 * @returns {Promise<string>} signed JWT string
 */
export async function signJWT(payload, secret, expiresInSeconds = 86400) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iss: 'sweethopebakeryy',
    iat: now,
    exp: now + expiresInSeconds
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const encodedSignature = base64urlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify a JWT and return its payload.
 * @param {string} token - JWT string
 * @param {string} secret - HMAC signing secret
 * @returns {Promise<Object>} decoded payload
 * @throws {Error} if token is invalid, expired, or has wrong issuer
 */
export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // Verify signature
  const key = await getSigningKey(secret);
  const signatureBytes = base64urlDecode(encodedSignature);
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(signingInput));
  if (!valid) throw new Error('Invalid signature');

  // Decode and check claims
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encodedPayload)));

  if (payload.iss !== 'sweethopebakeryy') throw new Error('Invalid issuer');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error('Token expired');

  return payload;
}
