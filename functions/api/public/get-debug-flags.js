// GET /api/public/get-debug-flags
// Public endpoint that exposes non-sensitive debug flags for client logging.

export async function onRequestGet(context) {
  const { DEBUG_ERRORS, APP_ENV } = context.env;
  const debugErrors = DEBUG_ERRORS === 'true' || APP_ENV === 'development';
  return Response.json({ debugErrors });
}
