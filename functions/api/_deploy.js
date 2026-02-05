// Shared deploy hook helpers (debounced)

import { getKv } from './_kv.js';

const SCHEDULE_KEY = 'deploy/hook-schedule';
const RUNNER_KEY = 'deploy/hook-runner';
const MAX_SLEEP_MS = 30000;

function parseDebounceMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

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

async function sleepWithCap(ms) {
  let remaining = ms;
  while (remaining > 0) {
    const step = Math.min(remaining, MAX_SLEEP_MS);
    await sleep(step);
    remaining -= step;
  }
}

function getPurgeConfig(env) {
  return {
    enabled: parseBool(env.PAGES_PURGE_AFTER_DEPLOY),
    delayMs: parseDelayMs(env.PAGES_PURGE_DELAY_MS),
    token: env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN,
    zoneId: env.CLOUDFLARE_ZONE_ID || env.CF_ZONE_ID
  };
}

async function purgeCache(purgeConfig) {
  if (!purgeConfig?.enabled) return;
  if (!purgeConfig.token || !purgeConfig.zoneId) return;
  if (purgeConfig.delayMs > 0) {
    await sleepWithCap(purgeConfig.delayMs);
  }
  await fetch(`https://api.cloudflare.com/client/v4/zones/${purgeConfig.zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${purgeConfig.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ purge_everything: true })
  }).catch(() => {});
}

async function runHookAndPurge(deployHook, purgeConfig) {
  await fetch(deployHook, { method: 'POST' }).catch(() => {});
  await purgeCache(purgeConfig);
}

async function runDebouncedHook(kv, deployHook, purgeConfig, runnerKey = RUNNER_KEY) {
  try {
    while (true) {
      const state = await kv.get(SCHEDULE_KEY, 'json');
      const scheduledAt = Number(state?.scheduledAt || 0);
      if (!scheduledAt) break;

      const now = Date.now();
      const delay = scheduledAt - now;
      if (delay > 0) {
        await sleep(Math.min(delay, MAX_SLEEP_MS));
        continue;
      }

      await runHookAndPurge(deployHook, purgeConfig);
      await kv.put(SCHEDULE_KEY, JSON.stringify({ scheduledAt: 0 }));
      break;
    }
  } finally {
    try {
      await kv.delete(runnerKey);
    } catch {
      // ignore cleanup failures
    }
  }
}

export async function queueDeployHook(context) {
  try {
    const deployHook = context.env.PAGES_DEPLOY_HOOK_URL;
    if (!deployHook) return;
    const purgeConfig = getPurgeConfig(context.env);

    const debounceMs = parseDebounceMs(context.env.PAGES_DEPLOY_HOOK_DEBOUNCE_MS);
    if (!debounceMs) {
      context.waitUntil(runHookAndPurge(deployHook, purgeConfig));
      return;
    }

    const kv = getKv(context);
    if (!kv) {
      context.waitUntil(fetch(deployHook, { method: 'POST' }).catch(() => {}));
      return;
    }

    const scheduledAt = Date.now() + debounceMs;
    await kv.put(SCHEDULE_KEY, JSON.stringify({ scheduledAt }));

    const runner = await kv.get(RUNNER_KEY);
    if (!runner) {
      const ttlSeconds = Math.max(60, Math.ceil((debounceMs * 2) / 1000) + 30);
      await kv.put(RUNNER_KEY, '1', { expirationTtl: ttlSeconds });
      context.waitUntil(runDebouncedHook(kv, deployHook, purgeConfig, RUNNER_KEY));
    }
  } catch {
    // Ignore deploy hook errors to avoid breaking saves/deletes.
  }
}
