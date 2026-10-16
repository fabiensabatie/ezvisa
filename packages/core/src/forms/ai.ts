import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { type Anchor, describeTextLayer, type TextPage } from "./layout.js";
import { FORMATS, SOURCES } from "./sources.js";

/**
 * A blank found on a flat form: the printed text it belongs to, when the PDF has a text
 * layer, and Claude's own estimate as fractions of its page from the top-left corner.
 */
export type LocatedField = {
  label: string;
  type: "text" | "checkbox";
  /** Zero-based page index */
  page: number;
  box: { left: number; top: number; right: number; bottom: number };
  anchor?: Anchor | null;
  multiline: boolean;
};

export type DescribedField = {
  name: string;
  label: string;
  /** A source key, "ai" when an agent decides from the documents, or "none" for the team */
  source: string;
  format: string;
  hint: string;
};

export type ReadDocument = { kind: string; facts: Array<{ name: string; value: string }> };

export type FieldToFill = {
  name: string;
  label: string;
  type: string;
  options?: string[];
  hint?: string | null;
  /** How the value is printed (day, month, year-be...), so a date blank gets a whole date */
  format?: string;
};

export type FilledValue = { name: string; value: string; from: string };

/** A file Claude can read: PDFs and common images. */
export type ReadableFile = { bytes: Uint8Array; mimeType: string; filename: string };

/** The model work behind forms. The server uses Claude; tests script one. */
export interface FormAi {
  readonly name: string;
  /** Finds where a flat form expects writing or a tick, anchored to its printed text. */
  locateFields(pdf: Uint8Array, text: TextPage[]): Promise<LocatedField[]>;
  /** Labels each field and says where its value comes from. */
  describeFields(
    pdf: Uint8Array,
    fields: Array<{ name: string; type: string; page: number; options?: string[] }>,
  ): Promise<DescribedField[]>;
  /** Says what a client's document is and the facts printed on it. */
  readDocument(file: ReadableFile): Promise<ReadDocument>;
  /** Fills the fields no record covers, from the case's facts; unknown stays empty. */
  fillFields(form: string, fields: FieldToFill[], facts: unknown): Promise<FilledValue[]>;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export function canRead(mimeType: string): boolean {
  return mimeType === "application/pdf" || (IMAGE_TYPES as readonly string[]).includes(mimeType);
}

const SYSTEM = `You prepare Thai immigration paperwork for a visa agency in Chiang Mai. You read official forms and the documents clients send (passports, visas, bank letters, leases, TM.6 and TM.30 receipts), and you are exact: copy names, numbers and dates as printed, write dates as YYYY-MM-DD, and leave a value empty rather than guess.`;

const located = z.object({
  fields: z.array(
    z.object({
      label: z.string().describe("What the blank asks for, in English, e.g. 'Family name'"),
      type: z.enum(["text", "checkbox"]),
      page: z.number().int().describe("Page number, starting at 1"),
      left: z
        .number()
        .describe("Left edge of the writing space, fraction of page width from the left"),
      top: z.number().describe("Top edge, fraction of page height from the top"),
      right: z.number().describe("Right edge, fraction of page width"),
      bottom: z.number().describe("Bottom edge, fraction of page height"),
      multiline: z.boolean().describe("True for a space of several lines"),
      anchor: z
        .object({
          kind: z
            .enum(["after", "on", "before"])
            .describe(
              "after: the blank follows this label on its line; on: this item is the blank itself (a run of dots or underscores, or a box glyph); before: a tick box printed just left of this option's text",
            ),
          item: z.number().int().describe("The #id of the printed text"),
          until: z
            .number()
            .int()
            .nullable()
            .describe(
              "For after: the #id of the next label on the same line, where the blank ends; null when it runs to the end of the line",
            ),
        })
        .nullable()
        .describe("The printed text the blank belongs to; null only when none fits"),
    }),
  ),
});

const described = z.object({
  fields: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      source: z.string(),
      format: z.enum(FORMATS.map((f) => f.key) as [string, ...string[]]),
      hint: z.string(),
    }),
  ),
});

const read = z.object({
  kind: z.string().describe("What the document is, e.g. 'Passport', 'Bank letter', 'TM.6 card'"),
  facts: z.array(z.object({ name: z.string(), value: z.string() })),
});

const filled = z.object({
  values: z.array(
    z.object({
      name: z.string(),
      value: z.string().describe("The value, or an empty string when the facts do not say"),
      from: z
        .string()
        .describe("Where it came from, e.g. 'Passport', 'Bank letter', 'client record'"),
    }),
  ),
});

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export class ClaudeFormAi implements FormAi {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly name: string = "claude-opus-5-5",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 5 * 60_000 });
  }

  private async ask<T>(
    schema: z.ZodType<T>,
    content: Anthropic.Beta.BetaContentBlockParam[],
    effort: "medium" | "high",
  ): Promise<T> {
    const response = await this.client.beta.messages.parse({
      model: this.name,
      max_tokens: 16000,
      // A declined request is retried on a fallback model instead of failing.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error(`The model did not answer (${response.stop_reason}).`);
    }
    return response.parsed_output as T;
  }

  private static pdf(bytes: Uint8Array): Anthropic.Beta.BetaContentBlockParam {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: Buffer.from(bytes).toString("base64"),
      },
    };
  }

  async locateFields(pdf: Uint8Array, text: TextPage[]): Promise<LocatedField[]> {
    const printed = text.some((p) => p.items.length > 0)
      ? `

The text printed on the form, one item per line with its #id and position in PDF points:
${describeTextLayer(text)}

For each blank, give its anchor: the item it belongs to. Most blanks follow their label on the same line (after), up to the next label on that line (until) or to the end of the line. When the label and its blank are printed together as dots or underscores, anchor on the dots. For a tick box, anchor before its option's text, or on the box glyph if one is printed. Bilingual forms print a Thai label and an English one below it: anchor to the label on the blank's own line.`
      : "";
    const answer = await this.ask(
      located,
      [
        ClaudeFormAi.pdf(pdf),
        {
          type: "text",
          text: `This is a blank form. List every place where the applicant or the agency writes something or ticks a box: one entry per blank line, box or cell, including signature and date lines, but not sections for official use only. Give the writing space only, not the printed label, as fractions of the page measured from its top-left corner.${printed}`,
        },
      ],
      "high",
    );
    return answer.fields
      .map((f) => ({
        label: f.label.trim(),
        type: f.type,
        page: Math.max(0, f.page - 1),
        box: {
          left: clamp(f.left),
          top: clamp(f.top),
          right: clamp(f.right),
          bottom: clamp(f.bottom),
        },
        anchor: f.anchor,
        multiline: f.multiline,
      }))
      .filter((f) => f.box.right > f.box.left && f.box.bottom > f.box.top);
  }

  async describeFields(
    pdf: Uint8Array,
    fields: Array<{ name: string; type: string; page: number; options?: string[] }>,
  ): Promise<DescribedField[]> {
    const sources = SOURCES.map((s) => `- ${s.key}: ${s.label}`).join("\n");
    const formats = FORMATS.map((f) => `- ${f.key}: ${f.label}`).join("\n");
    const answer = await this.ask(
      described,
      [
        ClaudeFormAi.pdf(pdf),
        {
          type: "text",
          text: `These are the form's fields:\n${JSON.stringify(fields)}\n\nFor each field give: a short English label; the source of its value, one of these keys when it fits exactly:\n${sources}\n"ai" when it must be read from the client's documents or worked out (place of birth, passport issue date, arrival date, occupation, reason for stay...), or "none" when only the agency staff can fill it (signatures, official use); the format, one of:\n${formats}\nand a hint for whoever fills it (empty if obvious). Thai forms usually want dates as written on the form: use date-be when the form shows Buddhist-era years (2560s). When a date is split into separate day, month and year blanks, give every blank the same source (for example today, or "ai" for an arrival date) with format day, month, and year-be where the year is in the Buddhist era (พ.ศ.) or year otherwise. The place where the form is written or filed ("written at") is case.office. An address split into road or lane, sub-district (tambon), district (amphoe) and province is "ai", as are boxes ticked for a visa category; say which part or category in the hint.`,
        },
      ],
      "high",
    );
    const known = new Set(fields.map((f) => f.name));
    return answer.fields.filter((f) => known.has(f.name));
  }

  async readDocument(file: ReadableFile): Promise<ReadDocument> {
    const block: Anthropic.Beta.BetaContentBlockParam =
      file.mimeType === "application/pdf"
        ? ClaudeFormAi.pdf(file.bytes)
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: file.mimeType as ImageType,
              data: Buffer.from(file.bytes).toString("base64"),
            },
          };
    return this.ask(
      read,
      [
        block,
        {
          type: "text",
          text: `File name: ${file.filename}. Say what this document is, then list the facts printed on it that an immigration form may ask for: names as printed, passport or document numbers, nationality, sex, dates (YYYY-MM-DD), places of birth and issue, addresses, amounts with currency, account or reference numbers, visa types and permitted-stay dates, issuing authority.`,
        },
      ],
      "medium",
    );
  }

  async fillFields(form: string, fields: FieldToFill[], facts: unknown): Promise<FilledValue[]> {
    const answer = await this.ask(
      filled,
      [
        {
          type: "text",
          text: `Form: ${form}\n\nFields to fill:\n${JSON.stringify(fields)}\n\nWhat is known about the case (client record, case, and facts read from the client's documents):\n${JSON.stringify(facts)}\n\nGive a value for each field from these facts only. Checkboxes take "true" or "false"; choice fields take one of their options exactly. Dates as YYYY-MM-DD, also for a blank whose format is day, month, year or year-be: EzVisa prints only that part. Today's date is the date the form is filled. Leave the value empty when the facts do not say.`,
        },
      ],
      "medium",
    );
    const known = new Set(fields.map((f) => f.name));
    return answer.values.filter((v) => known.has(v.name));
  }
}

/** Claude from ANTHROPIC_API_KEY, model FORMS_MODEL (Claude Opus 5.5 by default). Null without a key. */
export function formAiFromEnv(env: NodeJS.ProcessEnv = process.env): FormAi | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? new ClaudeFormAi(key, env.FORMS_MODEL?.trim() || "claude-opus-5-5") : null;
}
