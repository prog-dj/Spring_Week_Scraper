import type { AuthUser, Env } from "../types";
import { listApplications } from "./applications";
import { listDocuments } from "./documents";
import { listSaved } from "./saved";

// GDPR right-to-access/portability: everything this account has stored,
// as a single downloadable JSON export (excludes the raw file bytes in R2 --
// those are still reachable individually via the existing download endpoint
// while the account exists).
export async function exportAccountData(env: Env, user: AuthUser): Promise<Record<string, unknown>> {
  const [applications, saved, documents, workspaces] = await Promise.all([
    listApplications(env, user.id),
    listSaved(env, user.id),
    listDocuments(env, user.id),
    env.DB.prepare("SELECT opportunity_id, payload, updated_at FROM application_workspaces WHERE user_id = ?")
      .bind(user.id)
      .all<{ opportunity_id: string; payload: string; updated_at: string }>(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      email: user.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      createdAsAdmin: Boolean(user.is_admin),
    },
    applications,
    savedOpportunityIds: saved,
    documents: documents.map((d) => ({
      id: d.id,
      name: d.name,
      docType: d.doc_type,
      sizeBytes: d.size_bytes,
      status: d.status,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
    applicationWorkspaces: workspaces.results.map((row) => ({
      opportunityId: row.opportunity_id,
      payload: JSON.parse(row.payload),
      updatedAt: row.updated_at,
    })),
  };
}

// GDPR right to erasure: removes every row and R2 object tied to this
// account. Global data (the shared `opportunities` catalog) is untouched --
// only this user's own tracked data disappears.
export async function deleteAccount(env: Env, userId: number): Promise<void> {
  const documents = await listDocuments(env, userId);
  await Promise.all(
    documents.filter((d) => d.storage_ref).map((d) => env.DOCUMENTS.delete(d.storage_ref as string))
  );

  await env.DB.batch([
    env.DB.prepare("DELETE FROM documents WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM applications WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM saved_opportunities WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM application_workspaces WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
}
