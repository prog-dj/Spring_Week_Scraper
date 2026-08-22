import type { Env, AuthUser } from "../types";

function utcNow(): string {
  return new Date().toISOString();
}

function adminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Upsert on google_sub (Google's stable user id), not email -- email can
// theoretically change on the Google account, sub cannot.
export async function getOrCreateUserFromGoogleProfile(
  env: Env,
  profile: { googleSub: string; email: string; name: string | null; avatarUrl: string | null }
): Promise<AuthUser> {
  const now = utcNow();
  const isAdmin = adminEmails(env).has(profile.email.toLowerCase()) ? 1 : 0;

  const existing = await env.DB.prepare("SELECT * FROM users WHERE google_sub = ?")
    .bind(profile.googleSub)
    .first<AuthUser>();

  if (existing) {
    await env.DB.prepare(
      "UPDATE users SET email = ?, name = ?, avatar_url = ?, last_login_at = ?, is_admin = MAX(is_admin, ?) WHERE google_sub = ?"
    )
      .bind(profile.email, profile.name, profile.avatarUrl, now, isAdmin, profile.googleSub)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO users (google_sub, email, name, avatar_url, is_admin, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(profile.googleSub, profile.email, profile.name, profile.avatarUrl, isAdmin, now, now)
      .run();
  }

  const row = await env.DB.prepare("SELECT * FROM users WHERE google_sub = ?")
    .bind(profile.googleSub)
    .first<AuthUser>();
  if (!row) throw new Error("user upsert did not persist");
  return row;
}

export async function getUserById(env: Env, id: number): Promise<AuthUser | null> {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<AuthUser>();
  return row ?? null;
}
