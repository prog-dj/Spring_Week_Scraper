import { SignJWT, jwtVerify } from "jose";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { HonoEnv } from "../types";

const SESSION_COOKIE = "springr_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches the old Flask PERMANENT_SESSION_LIFETIME

function secretKey(env: { SESSION_SECRET: string }) {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function createSessionCookie(c: Context<HonoEnv>, userId: number): Promise<void> {
  const jwt = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_LIFETIME_SECONDS}s`)
    .sign(secretKey(c.env));

  setCookie(c, SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "Lax",
    // Secure cookies are only sent over HTTPS; local `wrangler dev` runs over
    // plain http://127.0.0.1, so gate this the same way the Flask config did.
    secure: c.env.ENVIRONMENT === "production",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function readSessionUserId(c: Context<HonoEnv>): Promise<number | null> {
  const jwt = getCookie(c, SESSION_COOKIE);
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, secretKey(c.env));
    const uid = payload.uid;
    return typeof uid === "number" ? uid : null;
  } catch {
    // expired, tampered, or signed with a since-rotated secret -- treat as logged out
    return null;
  }
}

// Short-lived cookie holding the PKCE code_verifier + CSRF state between
// /auth/login and /auth/callback. Signed so it can't be forged, but not the
// session cookie itself -- this one never grants access to anything, it just
// has to survive the round trip to Google and back.
const OAUTH_STATE_COOKIE = "springr_oauth_state";

export async function createOAuthStateCookie(
  c: Context<HonoEnv>,
  data: { state: string; codeVerifier: string }
): Promise<void> {
  const jwt = await new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secretKey(c.env));

  setCookie(c, OAUTH_STATE_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "Lax",
    secure: c.env.ENVIRONMENT === "production",
    path: "/auth",
    maxAge: 600,
  });
}

export async function readAndClearOAuthStateCookie(
  c: Context<HonoEnv>
): Promise<{ state: string; codeVerifier: string } | null> {
  const jwt = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/auth" });
  if (!jwt) return null;
  try {
    const { payload } = await jwtVerify(jwt, secretKey(c.env));
    if (typeof payload.state !== "string" || typeof payload.codeVerifier !== "string") return null;
    return { state: payload.state, codeVerifier: payload.codeVerifier };
  } catch {
    return null;
  }
}
