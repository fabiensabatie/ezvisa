import { documents } from "@ezvisa/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { canAdminister, canEdit, canView, defineTool, type RawResult } from "../tool.js";

const INLINE_IMAGES = ["image/jpeg", "image/png", "image/webp"];

export const documentTools = [
  defineTool({
    name: "list_documents",
    title: "List documents",
    description: "Stored documents of a client or a case, newest first. Metadata only.",
    input: documents.listDocumentsInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("documents"),
    run: (ctx, input) => documents.listDocuments(ctx, input),
  }),
  defineTool({
    name: "get_document",
    title: "Get a document link",
    description:
      "Document metadata and a download link valid for 5 minutes. To look at the content yourself, use read_document.",
    input: documents.getDocumentInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("documents"),
    run: (ctx, input) => documents.getDocument(ctx, input),
  }),
  defineTool({
    name: "read_document",
    title: "Read a document",
    description:
      "Returns the document itself so you can read it: images inline, PDFs as an embedded file. Use it to check a document against the checklist and the template's known failures, then record what you found with update_document and update_case_item. Every read is logged.",
    input: documents.getDocumentInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("documents"),
    run: async (ctx, input): Promise<RawResult> => {
      const { document, bytes } = await documents.readDocument(ctx, input);
      const data = Buffer.from(bytes).toString("base64");
      const meta = { type: "text" as const, text: JSON.stringify(document, null, 2) };
      let content: CallToolResult["content"];
      if (INLINE_IMAGES.includes(document.mimeType)) {
        content = [meta, { type: "image", data, mimeType: document.mimeType }];
      } else if (document.mimeType === "application/pdf") {
        content = [
          meta,
          {
            type: "resource",
            resource: {
              uri: `ezvisa://documents/${document.id}`,
              mimeType: "application/pdf",
              blob: data,
            },
          },
        ];
      } else {
        content = [
          meta,
          {
            type: "text",
            text: `${document.mimeType} files cannot be shown inline. Use get_document for a download link.`,
          },
        ];
      }
      return { raw: { content } };
    },
  }),
  defineTool({
    name: "upload_document",
    title: "Upload a document",
    description:
      "Stores a client document sent as base64 (up to 10 MB): PDF, JPEG, PNG, WebP, HEIC or DOCX. Needs the client's privacy consent. Attaching it to a MISSING checklist item marks the item RECEIVED.",
    input: documents.uploadDocumentInput,
    visibleTo: canEdit("documents"),
    run: (ctx, input) => documents.uploadDocument(ctx, input),
  }),
  defineTool({
    name: "create_document_upload",
    title: "Start a large upload",
    description:
      "For files over 10 MB (up to 20 MB): returns a link to PUT the file to directly, valid for 10 minutes. Then call confirm_document_upload.",
    input: documents.createDocumentUploadInput,
    visibleTo: canEdit("documents"),
    run: (ctx, input) => documents.createDocumentUpload(ctx, input),
  }),
  defineTool({
    name: "confirm_document_upload",
    title: "Finish a large upload",
    description: "Registers a file uploaded through create_document_upload as a client document.",
    input: documents.confirmDocumentUploadInput,
    visibleTo: canEdit("documents"),
    run: (ctx, input) => documents.confirmDocumentUpload(ctx, input),
  }),
  defineTool({
    name: "update_document",
    title: "Record extracted fields",
    description:
      'Saves the fields you read from a document, e.g. {"passportNo": "123456789", "expiry": "2031-04-02"}. Replaces earlier extracted fields. Copy client details onto the client with update_client.',
    input: documents.updateDocumentInput,
    annotations: { idempotentHint: true },
    visibleTo: canEdit("documents"),
    run: (ctx, input) => documents.updateDocument(ctx, input),
  }),
  defineTool({
    name: "delete_document",
    title: "Delete a document",
    description: "Removes a document from the client's file. Kept in storage until retention ends.",
    input: documents.deleteDocumentInput,
    annotations: { destructiveHint: true },
    visibleTo: canAdminister("documents"),
    run: (ctx, input) => documents.deleteDocument(ctx, input),
  }),
];
