import type { Env } from "../types";

// Fixed-window rate limiter backed by D1 (the rate_limits table). Good enough
// at this app's scale -- avoids pulling in a separate KV/Durable Object just
// for login/upload throttling.
export async function checkRateLimit(
  env: Env,
  bucket: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number }
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT count, window_started_at FROM rate_limits WHERE bucket_key = ?")
    .bind(bucket)
    .first<{ count: number; window_started_at: string }>();

  if (!row) {
    await env.DB.prepare(
      "INSERT INTO rate_limits (bucket_key, count, window_started_at) VALUES (?, 1, ?)"
    )
      .bind(bucket, new Date(now).toISOString())
      .run();
    return { allowed: true };
  }

  const windowStarted = new Date(row.window_started_at).getTime();
  const elapsedSeconds = (now - windowStarted) / 1000;

  if (elapsedSeconds > windowSeconds) {
    await env.DB.prepare("UPDATE rate_limits SET count = 1, window_started_at = ? WHERE bucket_key = ?")
      .bind(new Date(now).toISOString(), bucket)
      .run();
    return { allowed: true };
  }

  if (row.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil(windowSeconds - elapsedSeconds) };
  }

  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket_key = ?").bind(bucket).run();
  return { allowed: true };
}

// Read-only version of checkRateLimit -- reports current usage without
// incrementing the counter, so a caller can show/act on remaining quota
// before committing to the action that would consume it.
export async function peekRateLimit(
  env: Env,
  bucket: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number }
): Promise<{ count: number; limit: number; remaining: number }> {
  const row = await env.DB.prepare("SELECT count, window_started_at FROM rate_limits WHERE bucket_key = ?")
    .bind(bucket)
    .first<{ count: number; window_started_at: string }>();

  if (!row) return { count: 0, limit, remaining: limit };

  const elapsedSeconds = (Date.now() - new Date(row.window_started_at).getTime()) / 1000;
  if (elapsedSeconds > windowSeconds) return { count: 0, limit, remaining: limit };

  return { count: row.count, limit, remaining: Math.max(0, limit - row.count) };
}
