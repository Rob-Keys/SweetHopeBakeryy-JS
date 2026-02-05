// config.js - client-safe configuration.
// Sensitive keys (AWS, Stripe secret) live in environment variables and stay server-side.

const config = {
  // Stripe publishable key (safe for client use).
  // Prefer fetching from the server to stay in sync; this is a fallback.
  stripePublicKey: 'pk_live_51SFzIfAEKe5eKbDNqRlQeB7ireuGTYpSiCROz7WO0IDW2nqWMzUpKA6n5HKyqClX02ZBJEggEN7YegYXvAzGaqKn00pkageJQl'
};

export default config;
