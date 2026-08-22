import type { Context, Next } from "hono";
import type { HonoEnv } from "../types";
import { readSessionUserId } from "./session";
import { getUserById } from "../db/users";

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
