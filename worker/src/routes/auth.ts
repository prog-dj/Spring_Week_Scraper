import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { randomToken, pkceChallenge, buildAuthorizeUrl, exchangeCodeForProfile } from "../auth/google";
import {
  createOAuthStateCookie,
  readAndClearOAuthStateCookie,
  createSessionCookie,
  clearSessionCookie,
} from "../auth/session";
import { getOrCreateUserFromGoogleProfile } from "../db/users";
import { checkRateLimit } from "../storage/rateLimit";

export const authRoutes = new Hono<HonoEnv>({ strict: false });

function redirectUri(c: { req: { url: string } }): string {
  return new URL("/auth/callback", c.req.url).toString();
}

authRoutes.get("/login", async (c) => {
  // Throttle by client IP -- caps how often a single client can kick off the
  // OAuth dance, independent of Google's own rate limiting.
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `login:${ip}`, {
    limit: 10,
    windowSeconds: 60,
  });
  if (!allowed) {
    return c.json({ error: "too many login attempts, try again shortly" }, 429, {
      "Retry-After": String(retryAfterSeconds ?? 60),
    });
  }

  const state = randomToken(16);
  const codeVerifier = randomToken(32);
  const codeChallenge = await pkceChallenge(codeVerifier);

  await createOAuthStateCookie(c, { state, codeVerifier });

  const url = await buildAuthorizeUrl({
    clientId: c.env.GOOGLE_CLIENT_ID,
    redirectUri: redirectUri(c),
    state,
    codeChallenge,
  });
  return c.redirect(url);
});

authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stored = await readAndClearOAuthStateCookie(c);

  if (!code || !state || !stored || state !== stored.state) {
    return c.text("Invalid or expired login attempt. Please try signing in again.", 400);
  }

  try {
    const profile = await exchangeCodeForProfile({
      code,
      codeVerifier: stored.codeVerifier,
      clientId: c.env.GOOGLE_CLIENT_ID,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET,
      redirectUri: redirectUri(c),
    });

    const user = await getOrCreateUserFromGoogleProfile(c.env, {
      googleSub: profile.sub,
      email: profile.email,
      name: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
    });

    await createSessionCookie(c, user.id);
    return c.redirect("/");
  } catch (err) {
    console.error("OAuth callback failed", err);
    return c.text("Sign-in failed. Please try again.", 400);
  }
});

authRoutes.get("/logout", (c) => {
  clearSessionCookie(c);
  return c.redirect("/");
});
