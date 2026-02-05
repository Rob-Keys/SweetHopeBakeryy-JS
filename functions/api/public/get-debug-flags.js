// GET /api/public/get-debug-flags
// Exposes debug flags for client-side logging (non-sensitive)

export async function onRequestGet(context) {
  const { DEBUG_ERRORS, APP_ENV } = context.env;
  const debugErrors = DEBUG_ERRORS === 'true' || APP_ENV === 'development';
  return Response.json({ debugErrors });
}
