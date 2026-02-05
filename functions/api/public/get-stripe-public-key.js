// GET /api/public/get-stripe-public-key
// Public endpoint for the Stripe publishable key (environment-specific).

export async function onRequestGet(context) {
  const { STRIPE_PUBLIC_KEY } = context.env;
  if (!STRIPE_PUBLIC_KEY) {
    return Response.json({ error: 'STRIPE_PUBLIC_KEY not configured' }, { status: 500 });
  }
  return Response.json({ publicKey: STRIPE_PUBLIC_KEY });
}
