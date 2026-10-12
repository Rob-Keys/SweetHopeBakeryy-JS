// GET /api/deployment-version
// Returns the commit SHA for the Pages deployment currently serving this request.

export function onRequestGet({ env }) {
  const commit = env.CF_PAGES_COMMIT_SHA || '';
  return Response.json(
    { commit: commit ? commit.slice(0, 7) : 'unknown' },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'CDN-Cache-Control': 'no-store',
        'Pragma': 'no-cache'
      }
    }
  );
}
