import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { deleteAccount, exportAccountData } from "../db/account";
import { clearSessionCookie } from "../auth/session";

export const accountRoutes = new Hono<HonoEnv>({ strict: false });

// GDPR right to access/portability -- a full JSON export of everything this
// account has stored (see db/account.ts for exactly what's included).
accountRoutes.get("/export", async (c) => {
  const user = c.get("user")!;
  const data = await exportAccountData(c.env, user);
  return c.json(data, 200, {
    "Content-Disposition": `attachment; filename="springr-account-export.json"`,
  });
});

// GDPR right to erasure -- deletes the account and every row/file tied to
// it. Irreversible; the frontend is expected to confirm before calling this.
accountRoutes.delete("/", async (c) => {
  const user = c.get("user")!;
  await deleteAccount(c.env, user.id);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
