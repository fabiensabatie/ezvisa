// Mirrors ALLOWED_MIME_TYPES and MAX_UPLOAD_BYTES in packages/core/src/services/files.ts.
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const ACCEPT = Object.keys(TYPES)
  .map((ext) => `.${ext}`)
  .join(",");
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** The file's type, from the browser or, when it does not know (often HEIC), the extension. */
export function mimeOf(file: File): string {
  const known = Object.values(TYPES);
  if (known.includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? file.type;
}

/** A reason the server would refuse the file, checked before uploading anything. */
export function fileProblem(file: File): string | null {
  if (!Object.values(TYPES).includes(mimeOf(file))) {
    return `${file.name} is not a PDF, JPEG, PNG, WebP, HEIC or DOCX file.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is over 20 MB.`;
  return null;
}

/** PUTs a file to a presigned link: straight to the bucket, not through the server. */
export async function putFile(
  link: { uploadUrl: string; headers: Record<string, string> },
  file: File,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(link.uploadUrl, { method: "PUT", headers: link.headers, body: file });
  } catch {
    throw new Error("The upload could not reach file storage. Check your connection and retry.");
  }
  if (!res.ok) throw new Error(`File storage refused the upload (${res.status}). Try again.`);
}
