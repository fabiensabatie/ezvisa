import { documents } from "@ezvisa/core";
import { canAdminister, canEdit, canView, defineTool, type RawResult } from "../tool.js";
import { fileContent } from "./file-content.js";

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
      "Document metadata and a link valid for 5 minutes, plus a ready-made curl command that saves the file to disk under its name (with download: true the link saves rather than opens in a browser). Use it to work on a file with your own tools, or for files too large for read_document. Every link is logged.",
    input: documents.getDocumentInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("documents"),
    run: (ctx, input) => documents.getDocument(ctx, input),
  }),
  defineTool({
    name: "read_document",
    title: "Read a document",
    description:
      "Returns the document itself so you can read it: images inline, PDFs as an embedded file, up to 10 MB (larger files: get_document). Use it to check a document against the checklist and the template's known failures, then record what you found with update_document and update_case_item. Every read is logged.",
    input: documents.getDocumentInput,
    annotations: { readOnlyHint: true },
    visibleTo: canView("documents"),
    run: async (ctx, input): Promise<RawResult> => {
      const { document, bytes } = await documents.readDocument(ctx, input);
      return {
        raw: {
          content: fileContent({
            metadata: document,
            bytes,
            mimeType: document.mimeType,
            uri: `ezvisa://documents/${document.id}`,
            otherwise: "Use get_document to save it to disk.",
          }),
        },
      };
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
      "For a file on disk, or any file over 10 MB (up to 20 MB): returns a link to PUT the file's raw bytes to directly, without base64, valid for 10 minutes. Then call confirm_document_upload.",
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
