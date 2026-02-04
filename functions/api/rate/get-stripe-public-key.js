// GET /api/rate/get-stripe-public-key
// Returns the Stripe publishable key for the active environment

export async function onRequestGet(context) {
  const { STRIPE_PUBLIC_KEY } = context.env;
  if (!STRIPE_PUBLIC_KEY) {
    return Response.json({ error: 'STRIPE_PUBLIC_KEY not configured' }, { status: 500 });
  }
  return Response.json({ publicKey: STRIPE_PUBLIC_KEY });
}
