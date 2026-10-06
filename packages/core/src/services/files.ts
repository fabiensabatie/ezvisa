import { createHash } from "node:crypto";
import { DomainError } from "../errors.js";

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

/** Inline uploads (base64 through MCP) are capped lower than presigned uploads. */
export const MAX_INLINE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function assertMimeType(mimeType: string): void {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new DomainError(
      "VALIDATION",
      `Files of type ${mimeType} are not accepted. Use PDF, JPEG, PNG, WebP, HEIC or DOCX.`,
    );
  }
}

export function decodeBase64File(contentBase64: string, mimeType: string) {
  assertMimeType(mimeType);
  const cleaned = contentBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new DomainError("VALIDATION", "contentBase64 is not valid base64.");
  }
  const bytes = new Uint8Array(Buffer.from(cleaned, "base64"));
  if (bytes.byteLength === 0) throw new DomainError("VALIDATION", "The file is empty.");
  if (bytes.byteLength > MAX_INLINE_BYTES) {
    throw new DomainError(
      "VALIDATION",
      "The file is over 10 MB. Use create_document_upload for large files.",
    );
  }
  return { bytes, sha256: sha256Hex(bytes) };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Keeps letters, digits, dots, dashes and underscores. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(-120) || "file";
}
