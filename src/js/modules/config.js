// config.js - Client-safe configuration
// Sensitive keys (AWS, Stripe secret) will be handled by Lambda functions.

const config = {
  appEnv: 'development',

  stripePublicKey: 'pk_live_51SFzIfAEKe5eKbDNqRlQeB7ireuGTYpSiCROz7WO0IDW2nqWMzUpKA6n5HKyqClX02ZBJEggEN7YegYXvAzGaqKn00pkageJQl',

  pickupAddress: 'Arlington, VA, 22207',

  // SHA-256 hash of admin password for client-side auth
  // WARNING: Client-side auth is NOT secure. Placeholder until Lambda auth is implemented.
  // Dev password: 'password' -> this hash
  adminPasswordHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',

  // TODO: These will be handled server-side by Lambda
  // stripeSecretKey: <moved to Lambda>
  // awsKey: <moved to Lambda>
  // awsSecretKey: <moved to Lambda>
  // carolineEmailAddress: <moved to Lambda>
  // developerEmailAddress: <moved to Lambda>

  get returnUrl() {
    return this.appEnv === 'development'
      ? 'http://localhost:8080/return?session_id={CHECKOUT_SESSION_ID}'
      : 'https://sweethopebakeryy.com/return?session_id={CHECKOUT_SESSION_ID}';
  }
};

export default config;
