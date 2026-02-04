// Shared auth check for admin API functions
// Reads Authorization: Bearer <token> header, verifies JWT
// Returns null if authorized, or a 401 Response if not

import { verifyJWT } from './_jwt.js';

export async function checkAuth(context) {
  const { JWT_SECRET } = context.env;
  if (!JWT_SECRET) {
    return Response.json({ error: 'JWT_SECRET not configured' }, { status: 500 });
  }

  const authHeader = context.request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const token = authHeader.slice(7);
    await verifyJWT(token, JWT_SECRET);
    return null; // authorized
  } catch (err) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
