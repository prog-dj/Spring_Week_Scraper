import type { Env } from "../types";
import { utcNow } from "./opportunities";

export type Subscription = {
  user_id: number;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  updated_at: string;
};

export async function getSubscription(env: Env, userId: number): Promise<Subscription | null> {
  const row = await env.DB.prepare("SELECT * FROM subscriptions WHERE user_id = ?").bind(userId).first<Subscription>();
  return row ?? null;
}

export async function hasActiveSubscription(env: Env, userId: number): Promise<boolean> {
  const sub = await getSubscription(env, userId);
  return sub?.status === "active";
}

// Called only from the Stripe webhook handler -- this is the single place
// subscription state changes, driven by Stripe's own events rather than
// anything the client claims.
export async function upsertSubscription(
  env: Env,
  fields: {
    userId: number;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    status: string;
    currentPeriodEnd: string | null;
  }
): Promise<void> {
  const now = utcNow();
  await env.DB.prepare(
    `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       stripe_customer_id=excluded.stripe_customer_id,
       stripe_subscription_id=excluded.stripe_subscription_id,
       status=excluded.status,
       current_period_end=excluded.current_period_end,
       updated_at=excluded.updated_at`
  )
    .bind(fields.userId, fields.stripeCustomerId, fields.stripeSubscriptionId, fields.status, fields.currentPeriodEnd, now)
    .run();
}

// Looks up a user by the Stripe customer id stored on their subscription row
// -- used by webhook events that only carry the customer id, not our user_id.
export async function getUserIdByStripeCustomerId(env: Env, stripeCustomerId: string): Promise<number | null> {
  const row = await env.DB.prepare("SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?")
    .bind(stripeCustomerId)
    .first<{ user_id: number }>();
  return row?.user_id ?? null;
}
