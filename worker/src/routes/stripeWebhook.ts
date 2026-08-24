import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { getUserIdByStripeCustomerId, upsertSubscription } from "../db/subscriptions";

// Unauthenticated by session (Stripe isn't a logged-in user) but verified via
// Stripe's own HMAC signature header instead -- the equivalent of the shared-
// secret check on /internal/ingest, just Stripe's specific scheme.
export const stripeWebhookRoutes = new Hono<HonoEnv>({ strict: false });

const SIGNATURE_TOLERANCE_SECONDS = 300;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const timestamp = header.split(",").find((part) => part.startsWith("t="))?.slice(2);
  const signatures = header
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expectedHex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return signatures.some((sig) => timingSafeEqual(sig, expectedHex));
}

async function stripeGet(secretKey: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Stripe API error (${path}): ${JSON.stringify(data)}`);
  return data;
}

function toIso(unixSeconds: unknown): string | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;
}

stripeWebhookRoutes.post("/", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET || !c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "billing is not configured" }, 501);
  }

  const signatureHeader = c.req.header("Stripe-Signature");
  const payload = await c.req.text();
  if (!signatureHeader || !(await verifyStripeSignature(payload, signatureHeader, c.env.STRIPE_WEBHOOK_SECRET))) {
    return c.json({ error: "invalid signature" }, 400);
  }

  const event = JSON.parse(payload) as { type: string; data: { object: Record<string, unknown> } };
  const object = event.data.object;

  try {
    if (event.type === "checkout.session.completed") {
      const userId = Number(object.client_reference_id);
      const customerId = object.customer as string;
      const subscriptionId = object.subscription as string | null;
      if (!userId || !customerId || !subscriptionId) {
        return c.json({ status: "ignored: missing fields" });
      }
      const subscription = await stripeGet(c.env.STRIPE_SECRET_KEY, `subscriptions/${subscriptionId}`);
      await upsertSubscription(c.env, {
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        status: String(subscription.status),
        currentPeriodEnd: toIso(subscription.current_period_end),
      });
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const customerId = object.customer as string;
      const userId = await getUserIdByStripeCustomerId(c.env, customerId);
      if (!userId) {
        return c.json({ status: "ignored: unknown customer" });
      }
      await upsertSubscription(c.env, {
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: object.id as string,
        status: event.type === "customer.subscription.deleted" ? "canceled" : String(object.status),
        currentPeriodEnd: toIso(object.current_period_end),
      });
    }
  } catch (err) {
    console.error("Stripe webhook handling failed", err);
    return c.json({ error: "webhook handling failed" }, 500);
  }

  return c.json({ status: "ok" });
});
