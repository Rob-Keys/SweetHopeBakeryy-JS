// config.js - Client-safe configuration
// Sensitive keys (AWS, Stripe secret) are in Cloudflare Pages env vars, accessed by functions/api/*

const config = {
  // Stripe publishable key — safe to include client-side (this is its intended use).
  // Server fetch is preferred to stay in sync, but this acts as a fallback
  // when the fetch is rate-limited or unavailable.
  stripePublicKey: 'pk_live_51SFzIfAEKe5eKbDNqRlQeB7ireuGTYpSiCROz7WO0IDW2nqWMzUpKA6n5HKyqClX02ZBJEggEN7YegYXvAzGaqKn00pkageJQl'
};

export default config;
