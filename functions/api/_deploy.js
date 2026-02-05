// Shared deploy hook helpers (immediate + optional purge)

function parseDelayMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function parseBool(value) {
  return value === 'true' || value === '1' || value === true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getPurgeConfig(env) {
  return {
    enabled: parseBool(env.PAGES_PURGE_AFTER_DEPLOY),
    delayMs: parseDelayMs(env.PAGES_PURGE_DELAY_MS),
    token: env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN,
    zoneId: env.CLOUDFLARE_ZONE_ID || env.CF_ZONE_ID,
    debug: parseBool(env.PAGES_PURGE_DEBUG)
  };
}

async function purgeCache(purgeConfig) {
  if (!purgeConfig?.enabled) {
    if (purgeConfig?.debug) console.log('[deploy] purge disabled');
    return;
  }
  if (!purgeConfig.token || !purgeConfig.zoneId) {
    if (purgeConfig?.debug) console.log('[deploy] purge skipped: missing token or zone id');
    return;
  }
  if (purgeConfig.delayMs > 0) {
    if (purgeConfig?.debug) console.log('[deploy] purge delay ms', purgeConfig.delayMs);
    await sleep(purgeConfig.delayMs);
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${purgeConfig.zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${purgeConfig.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ purge_everything: true })
  }).catch((err) => {
    if (purgeConfig?.debug) console.log('[deploy] purge request failed', err?.message || err);
    return null;
  });
  if (purgeConfig?.debug) {
    console.log('[deploy] purge response', res?.status || 'no-response');
  }
}

async function runHookAndPurge(deployHook, purgeConfig) {
  const hookRes = await fetch(deployHook, { method: 'POST' }).catch((err) => {
    if (purgeConfig?.debug) console.log('[deploy] deploy hook failed', err?.message || err);
    return null;
  });
  if (purgeConfig?.debug) {
    console.log('[deploy] deploy hook response', hookRes?.status || 'no-response');
  }
  await purgeCache(purgeConfig);
}

export async function queueDeployHook(context) {
  try {
    const deployHook = context.env.PAGES_DEPLOY_HOOK_URL;
    if (!deployHook) return;
    const purgeConfig = getPurgeConfig(context.env);
    context.waitUntil(runHookAndPurge(deployHook, purgeConfig));
  } catch {
    // Ignore deploy hook errors to avoid breaking saves/deletes.
  }
}
