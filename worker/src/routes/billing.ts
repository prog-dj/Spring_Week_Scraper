import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { getSubscription } from "../db/subscriptions";

// Stripe's REST API is called directly via fetch -- there's no official
// Stripe SDK for the Workers runtime, and the API surface needed here
// (Checkout Sessions, Billing Portal Sessions) is small enough that a
// hand-rolled client isn't worth pulling in a dependency for.
const STRIPE_API = "https://api.stripe.com/v1";

export const billingRoutes = new Hono<HonoEnv>({ strict: false });

function requireStripeConfigured(env: { STRIPE_SECRET_KEY?: string; STRIPE_PRICE_ID?: string }): string | null {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return "billing is not configured yet";
  }
  return null;
}

async function stripeRequest(secretKey: string, path: string, body: Record<string, string>) {
  const response = await fetch(`${STRIPE_API}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Stripe API error (${path}): ${JSON.stringify(data)}`);
  }
  return data;
}

billingRoutes.post("/checkout", async (c) => {
  const configError = requireStripeConfigured(c.env);
  if (configError) return c.json({ error: configError }, 501);

  const user = c.get("user")!;
  try {
    const session = await stripeRequest(c.env.STRIPE_SECRET_KEY!, "checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": c.env.STRIPE_PRICE_ID!,
      "line_items[0][quantity]": "1",
      customer_email: user.email,
      // client_reference_id ties the Checkout Session back to our own user id
      // -- the webhook uses this to know who just subscribed.
      client_reference_id: String(user.id),
      success_url: new URL("/#practice", c.req.url).toString(),
      cancel_url: new URL("/#practice", c.req.url).toString(),
    });
    return c.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session creation failed", err);
    return c.json({ error: "could not start checkout" }, 502);
  }
});

billingRoutes.post("/portal", async (c) => {
  const configError = requireStripeConfigured(c.env);
  if (configError) return c.json({ error: configError }, 501);

  const user = c.get("user")!;
  const subscription = await getSubscription(c.env, user.id);
  if (!subscription) {
    return c.json({ error: "no subscription on file yet" }, 404);
  }

  try {
    const session = await stripeRequest(c.env.STRIPE_SECRET_KEY!, "billing_portal/sessions", {
      customer: subscription.stripe_customer_id,
      return_url: new URL("/#documents", c.req.url).toString(),
    });
    return c.json({ url: session.url });
  } catch (err) {
    console.error("Stripe billing portal session creation failed", err);
    return c.json({ error: "could not open billing portal" }, 502);
  }
});
