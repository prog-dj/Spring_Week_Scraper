import type { Env } from "../types";
import { utcNow } from "./opportunities";

export type DocumentRow = {
  id: number;
  user_id: number;
  name: string;
  doc_type: string;
  size_bytes: number | null;
  status: string | null;
  storage_ref: string | null;
  content_type: string | null;
  created_at: string;
  updated_at: string;
};

export async function listDocuments(env: Env, userId: number): Promise<DocumentRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<DocumentRow>();
  return results;
}

export async function getDocument(env: Env, userId: number, documentId: number): Promise<DocumentRow | null> {
  const row = await env.DB.prepare("SELECT * FROM documents WHERE user_id = ? AND id = ?")
    .bind(userId, documentId)
    .first<DocumentRow>();
  return row ?? null;
}

export async function createDocument(
  env: Env,
  userId: number,
  fields: {
    name: string;
    docType: string;
    sizeBytes: number | null;
    status: string | null;
    storageRef: string | null;
    contentType: string | null;
  }
): Promise<DocumentRow> {
  const now = utcNow();
  const result = await env.DB.prepare(
    `INSERT INTO documents (user_id, name, doc_type, size_bytes, status, storage_ref, content_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, fields.name, fields.docType, fields.sizeBytes, fields.status, fields.storageRef, fields.contentType, now, now)
    .run();
  const row = await env.DB.prepare("SELECT * FROM documents WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first<DocumentRow>();
  if (!row) throw new Error("document insert did not persist");
  return row;
}

export async function deleteDocument(env: Env, userId: number, documentId: number): Promise<DocumentRow | null> {
  const row = await getDocument(env, userId, documentId);
  if (!row) return null;
  await env.DB.prepare("DELETE FROM documents WHERE user_id = ? AND id = ?").bind(userId, documentId).run();
  return row;
}
