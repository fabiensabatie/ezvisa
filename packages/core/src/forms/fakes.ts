import type {
  DescribedField,
  FieldToFill,
  FilledValue,
  FormAi,
  LocatedField,
  ReadableFile,
  ReadDocument,
} from "./ai.js";
import type { TextPage } from "./layout.js";

/** A FormAi that answers from a script and records what it was asked, for tests. */
export class FakeFormAi implements FormAi {
  readonly name = "fake-forms";
  located: LocatedField[] = [];
  /** By field name; fields left out get no description. */
  descriptions: Record<string, Omit<DescribedField, "name">> = {};
  /** By filename */
  documents: Record<string, ReadDocument> = {};
  /** By field name */
  answers: Record<string, Omit<FilledValue, "name">> = {};
  readonly calls: string[] = [];
  readonly asked: FieldToFill[][] = [];

  /** The text layer the last locateFields call was given */
  text: TextPage[] = [];

  async locateFields(_pdf: Uint8Array, text: TextPage[]): Promise<LocatedField[]> {
    this.calls.push("locate");
    this.text = text;
    return this.located;
  }

  async describeFields(
    _pdf: Uint8Array,
    fields: Array<{ name: string; type: string; page: number }>,
  ): Promise<DescribedField[]> {
    this.calls.push("describe");
    return fields.flatMap((f) => {
      const d = this.descriptions[f.name];
      return d ? [{ name: f.name, ...d }] : [];
    });
  }

  async readDocument(file: ReadableFile): Promise<ReadDocument> {
    this.calls.push(`read ${file.filename}`);
    const read = this.documents[file.filename];
    if (!read) throw new Error(`Cannot read ${file.filename}`);
    return read;
  }

  async fillFields(_form: string, fields: FieldToFill[]): Promise<FilledValue[]> {
    this.calls.push("fill");
    this.asked.push(fields);
    return fields.flatMap((f) => {
      const a = this.answers[f.name];
      return a ? [{ name: f.name, ...a }] : [];
    });
  }
}
