import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const INLINE_IMAGES = ["image/jpeg", "image/png", "image/webp"];

/**
 * A file as MCP content the model can read: images inline, PDFs as an embedded resource,
 * other types (HEIC, DOCX) only described, with where to get them instead.
 */
export function fileContent(file: {
  metadata: unknown;
  bytes: Uint8Array;
  mimeType: string;
  uri: string;
  otherwise: string;
}): CallToolResult["content"] {
  const meta = { type: "text" as const, text: JSON.stringify(file.metadata, null, 2) };
  const data = Buffer.from(file.bytes).toString("base64");
  if (INLINE_IMAGES.includes(file.mimeType)) {
    return [meta, { type: "image", data, mimeType: file.mimeType }];
  }
  if (file.mimeType === "application/pdf") {
    return [
      meta,
      { type: "resource", resource: { uri: file.uri, mimeType: "application/pdf", blob: data } },
    ];
  }
  return [
    meta,
    {
      type: "text",
      text: `${file.mimeType} files cannot be shown inline. ${file.otherwise}`,
    },
  ];
}
