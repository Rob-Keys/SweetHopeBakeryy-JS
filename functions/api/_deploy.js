// Cache purge helper — clears Cloudflare CDN after KV writes.

export function queueCachePurge(context) {
  const { CLOUDFLARE_API_TOKEN, CF_API_TOKEN, CLOUDFLARE_ZONE_ID, CF_ZONE_ID } = context.env;
  const token = CLOUDFLARE_API_TOKEN || CF_API_TOKEN;
  const zoneId = CLOUDFLARE_ZONE_ID || CF_ZONE_ID;
  if (!token || !zoneId) return;

  context.waitUntil(
    fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ purge_everything: true })
    }).catch(() => {})
  );
}
