// Server-side file-type validation for document uploads (CVs, cover letters,
// transcripts). Extension/declared-Content-Type are never trusted alone --
// they're attacker-controlled -- so every upload is sniffed by magic bytes
// before it's allowed into R2.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

type AllowedType = {
  mimeType: string;
  extensions: string[];
  sniff: (bytes: Uint8Array) => boolean;
};

function matchesBytes(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

const ALLOWED_TYPES: AllowedType[] = [
  {
    mimeType: "application/pdf",
    extensions: [".pdf"],
    sniff: (b) => matchesBytes(b, 0, [0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  },
  {
    // .docx (and other OOXML) is a zip container; the zip local-file-header
    // signature is the strongest check available without a full zip parse.
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx"],
    sniff: (b) => matchesBytes(b, 0, [0x50, 0x4b, 0x03, 0x04]),
  },
  {
    // legacy .doc -- OLE Compound File Binary Format
    mimeType: "application/msword",
    extensions: [".doc"],
    sniff: (b) => matchesBytes(b, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  },
  {
    mimeType: "image/png",
    extensions: [".png"],
    sniff: (b) => matchesBytes(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mimeType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    sniff: (b) => matchesBytes(b, 0, [0xff, 0xd8, 0xff]),
  },
];

export type FileValidationResult =
  | { ok: true; mimeType: string }
  | { ok: false; reason: string };

function hasAllowedExtension(filename: string, allowed: AllowedType): boolean {
  const lower = filename.toLowerCase();
  return allowed.extensions.some((ext) => lower.endsWith(ext));
}

export function validateUploadedFile(filename: string, bytes: Uint8Array): FileValidationResult {
  if (bytes.length === 0) return { ok: false, reason: "file is empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: "file exceeds 10MB limit" };

  // Require the file's actual content (magic bytes) to match a real signature
  // AND that signature's type to match the filename's extension -- catches
  // both "renamed .exe to .pdf" and "genuine .png named .pdf".
  for (const allowed of ALLOWED_TYPES) {
    if (allowed.sniff(bytes)) {
      if (!hasAllowedExtension(filename, allowed)) {
        return { ok: false, reason: `file content is ${allowed.mimeType} but filename extension doesn't match` };
      }
      return { ok: true, mimeType: allowed.mimeType };
    }
  }
  return { ok: false, reason: "unrecognized or unsupported file type (allowed: PDF, DOC, DOCX, PNG, JPG)" };
}

// Strips path separators and control characters, keeps the upload's own
// extension -- the stored R2 key already namespaces by user id + a random
// uuid, so this is defense-in-depth against path traversal / header
// injection via a crafted filename, not the primary uniqueness guarantee.
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/[\\/]/g, "_").replace(/[\x00-\x1f]/g, "").trim();
  return base.slice(-200) || "upload";
}
