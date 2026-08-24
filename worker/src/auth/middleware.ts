import type { Context, Next } from "hono";
import type { HonoEnv } from "../types";
import { readSessionUserId } from "./session";
import { getUserById } from "../db/users";
import { hasActiveSubscription } from "../db/subscriptions";

// Runs on every request, populates c.get("user") -- the Hono equivalent of the
// Flask before_request hook that set flask.g.user.
export async function loadCurrentUser(c: Context<HonoEnv>, next: Next) {
  const userId = await readSessionUserId(c);
  c.set("user", userId ? await getUserById(c.env, userId) : null);
  await next();
}

export async function requireAuth(c: Context<HonoEnv>, next: Next) {
  if (!c.get("user")) {
    return c.json({ error: "authentication required" }, 401);
  }
  await next();
}

export async function requireAdmin(c: Context<HonoEnv>, next: Next) {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "authentication required" }, 401);
  }
  if (!user.is_admin) {
    return c.json({ error: "admin access required" }, 403);
  }
  await next();
}

// Gates the paid Interview Practice feature. Checked server-side against the
// subscriptions table (kept in sync by the Stripe webhook) -- never trusts
// anything the client claims about its own subscription state.
export async function requireSubscription(c: Context<HonoEnv>, next: Next) {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "authentication required" }, 401);
  }
  if (!(await hasActiveSubscription(c.env, user.id))) {
    return c.json({ error: "an active subscription is required for this feature" }, 402);
  }
  await next();
}
