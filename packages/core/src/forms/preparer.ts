import { type Db, Prisma } from "@ezvisa/db";
import type { Actor, Context, FormJobs } from "../context.js";
import { NO_PERMISSIONS } from "../permissions.js";
import { ASSISTANT_EMAIL } from "../seed-base.js";
import { analyzeTemplateForm, prepareCaseForms } from "../services/forms.js";
import type { Storage } from "../storage.js";
import type { FormAi } from "./ai.js";

export type FormPreparerDeps = {
  db: Db;
  storage: Storage | null;
  ai: FormAi | null;
  now?: () => Date;
};

/**
 * Runs form work in the background as the assistant: sets up template PDFs for filling and
 * fills a case's forms when its documents are in. One run at a time per case or file; a
 * request during a run starts one more run after it, so the latest documents are used.
 * Everything it fills is a draft: a person checks each form.
 */
export class FormPreparer implements FormJobs {
  private readonly running = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();
  private readonly now: () => Date;

  constructor(private readonly deps: FormPreparerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  prepareCase(caseId: string): void {
    this.queue(`case:${caseId}`, () => this.fillCase(caseId));
  }

  setUpTemplateFile(fileId: string): void {
    this.queue(`file:${fileId}`, () => this.setUp(fileId));
  }

  /**
   * Sets up every template PDF form and letter that is not set up yet, one after another:
   * those attached before EzVisa filled forms, or whose setup failed. Versions sharing a
   * file are set up once.
   */
  setUpPending(): void {
    this.queue("pending", async () => {
      const files = await this.deps.db.templateFile.findMany({
        where: {
          fieldMap: { equals: Prisma.DbNull },
          mimeType: "application/pdf",
          kind: { in: ["PDF_FORM", "LETTER"] },
        },
        select: { id: true, storageKey: true },
        orderBy: { id: "desc" },
      });
      const done = new Set<string>();
      for (const file of files) {
        if (done.has(file.storageKey)) continue;
        done.add(file.storageKey);
        try {
          await this.setUp(file.id);
        } catch (error) {
          console.log(
            JSON.stringify({
              level: "warn",
              msg: "form setup failed",
              fileId: file.id,
              error: String(error),
            }),
          );
          continue;
        }
        const set = await this.deps.db.templateFile.findUnique({ where: { id: file.id } });
        if (!set?.fieldMap) continue;
        await this.deps.db.templateFile.updateMany({
          where: { storageKey: file.storageKey, fieldMap: { equals: Prisma.DbNull } },
          data: { fieldMap: set.fieldMap as Prisma.InputJsonValue, fillableKey: set.fillableKey },
        });
      }
    });
  }

  preparing(caseId: string): boolean {
    return this.running.has(`case:${caseId}`);
  }

  settingUp(fileId: string): boolean {
    return this.running.has(`file:${fileId}`);
  }

  /** Resolves once nothing is running, for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running.values());
  }

  private queue(key: string, work: () => Promise<void>) {
    if (this.running.has(key)) {
      this.again.add(key);
      return;
    }
    const run = (async () => {
      do {
        this.again.delete(key);
        try {
          await work();
        } catch (error) {
          console.log(
            JSON.stringify({
              level: "warn",
              msg: "form job failed",
              job: key,
              error: String(error),
            }),
          );
        }
      } while (this.again.has(key));
    })().finally(() => this.running.delete(key));
    this.running.set(key, run);
  }

  /** The assistant, allowed only what preparing forms takes. */
  private async context(): Promise<Context | null> {
    const { db, storage, ai } = this.deps;
    if (!storage) return null;
    const assistant = await db.employee.findUnique({ where: { email: ASSISTANT_EMAIL } });
    if (!assistant?.active) return null;
    const actor: Actor = {
      employeeId: assistant.id,
      name: "Form preparer",
      roleName: "Form preparer",
      kind: "ASSISTANT",
      permissions: { ...NO_PERMISSIONS, cases: "edit", templates: "edit", documents: "view" },
      tokenId: "system:forms",
    };
    return { actor, via: "SYSTEM", db, storage, now: this.now, forms: ai };
  }

  private async fillCase(caseId: string) {
    const kase = await this.deps.db.case.findUnique({ where: { id: caseId } });
    if (!kase || kase.stage === "DONE" || kase.stage === "CANCELLED") return;
    const ctx = await this.context();
    if (ctx) await prepareCaseForms(ctx, { case: caseId });
  }

  private async setUp(fileId: string) {
    const ctx = await this.context();
    if (ctx) await analyzeTemplateForm(ctx, { fileId });
  }
}
