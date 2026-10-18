// KV remains for order snapshots created by legacy checkout flows.

export function getKv(context) {
  return context.env['kv-db'];
}
