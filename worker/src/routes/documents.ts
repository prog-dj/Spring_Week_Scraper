import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { createDocument, deleteDocument, getDocument, listDocuments } from "../db/documents";
import { validateUploadedFile, sanitizeFilename, MAX_UPLOAD_BYTES } from "../storage/fileValidation";
import { checkRateLimit } from "../storage/rateLimit";

export const documentsRoutes = new Hono<HonoEnv>({ strict: false });

documentsRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  return c.json({ documents: await listDocuments(c.env, user.id) });
});

// Real server-side file storage in R2 -- replaces the old client-only
// IndexedDB approach (files now genuinely land on a server, hence the upload
// hardening: size cap, magic-byte sniffing, per-user rate limiting).
documentsRoutes.post("/", async (c) => {
  const user = c.get("user")!;

  const { allowed, retryAfterSeconds } = await checkRateLimit(c.env, `upload:${user.id}`, {
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!allowed) {
    return c.json({ error: "too many uploads, try again later" }, 429, {
      "Retry-After": String(retryAfterSeconds ?? 3600),
    });
  }

  const contentType = c.req.header("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "expected multipart/form-data upload" }, 400);
  }

  const form = await c.req.formData();
  const file = form.get("file");
  const docType = form.get("doc_type");
  if (!(file instanceof File) || typeof docType !== "string" || !docType) {
    return c.json({ error: "file and doc_type are required" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: "file exceeds 10MB limit" }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = sanitizeFilename(file.name || "upload");
  const validation = validateUploadedFile(filename, bytes);
  if (!validation.ok) {
    return c.json({ error: validation.reason }, 400);
  }

  const storageRef = `documents/${user.id}/${crypto.randomUUID()}-${filename}`;
  await c.env.DOCUMENTS.put(storageRef, bytes, {
    httpMetadata: { contentType: validation.mimeType },
  });

  const displayName = (form.get("name") as string)?.trim() || filename;
  const document = await createDocument(c.env, user.id, {
    name: displayName,
    docType,
    sizeBytes: bytes.length,
    status: (form.get("status") as string) || null,
    storageRef,
    contentType: validation.mimeType,
  });
  return c.json({ document });
});

documentsRoutes.get("/:id/download", async (c) => {
  const user = c.get("user")!;
  const documentId = Number(c.req.param("id"));
  const document = await getDocument(c.env, user.id, documentId);
  if (!document || !document.storage_ref) return c.json({ error: "not found" }, 404);

  const object = await c.env.DOCUMENTS.get(document.storage_ref);
  if (!object) return c.json({ error: "not found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": document.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${document.name.replace(/"/g, "")}"`,
      // Documents are private per-user -- never cache at a shared/proxy layer.
      "Cache-Control": "private, no-store",
    },
  });
});

documentsRoutes.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const documentId = Number(c.req.param("id"));
  const document = await deleteDocument(c.env, user.id, documentId);
  if (document?.storage_ref) {
    await c.env.DOCUMENTS.delete(document.storage_ref);
  }
  return c.json({ ok: true });
});
