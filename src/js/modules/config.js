// config.js - Client-safe configuration
// Sensitive keys (AWS, Stripe secret) are in Cloudflare Pages env vars, accessed by functions/api/*

const config = {
  appEnv: 'development',

  stripePublicKey: 'pk_live_51SFzIfAEKe5eKbDNqRlQeB7ireuGTYpSiCROz7WO0IDW2nqWMzUpKA6n5HKyqClX02ZBJEggEN7YegYXvAzGaqKn00pkageJQl',

  pickupAddress: 'Arlington, VA, 22207',

  get returnUrl() {
    return this.appEnv === 'development'
      ? 'http://localhost:8080/return?session_id={CHECKOUT_SESSION_ID}'
      : 'https://sweethopebakeryy.com/return?session_id={CHECKOUT_SESSION_ID}';
  }
};

export default config;
