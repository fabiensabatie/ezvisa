import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCan } from "../lib/can";
import { toast } from "../lib/toast";
import { TONE } from "../lib/tones";
import { errorMessage, type Outputs, useTRPC } from "../trpc";
import { Button, Dialog, IconButton, INPUT } from "./controls";
import { Icon } from "./Icon";
import { type PageSize, PdfPages } from "./PdfPages";
import { Chip, Empty } from "./ui";

type TemplateForm = Outputs["forms"]["template"];
type Field = TemplateForm["fields"][number];
type Rect = [number, number, number, number];

const MIN = 6;

/** Where a field's value comes from, as the team reads it. */
export function sourceOptions(sources: TemplateForm["sources"]) {
  return [
    { value: "", label: "The team fills it" },
    { value: "ai", label: "Claude reads it from the documents" },
    ...sources.map((s) => ({ value: s.key, label: s.label })),
  ];
}

/** Keeps a 5-minute link until the PDF itself changes, so the preview is not redrawn. */
export function useStableUrl(url: string | null | undefined, version: string | undefined) {
  const [kept, setKept] = useState<{ url: string; version: string } | null>(null);
  useEffect(() => {
    if (url && version && version !== kept?.version) setKept({ url, version });
  }, [url, version, kept?.version]);
  return kept?.url ?? null;
}

/**
 * How EzVisa fills one template PDF: each field's label, source, format and hint, drawn on
 * the PDF. On a scan EzVisa made fillable, boxes can be moved, resized, added and removed.
 */
export function FormFieldsDialog({
  fileId,
  name,
  onClose,
}: {
  fileId: string;
  name: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const { can } = useCan();
  const editable = can("templates", "edit");
  const query = useQuery({
    ...trpc.forms.template.queryOptions({ fileId }),
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.settingUp ? 3000 : false),
  });
  const setUp = useMutation(trpc.forms.setUp.mutationOptions());
  const save = useMutation(trpc.forms.updateTemplate.mutationOptions({ meta: { quiet: true } }));
  const data = query.data;
  const url = useStableUrl(data?.pdfUrl, data?.version);

  const [fields, setFields] = useState<Field[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What is saved replaces what is being edited only when it changes (a save, a new setup).
  const saved = data && !data.settingUp ? JSON.stringify(data.fields) : null;
  useEffect(() => {
    if (saved) setFields(JSON.parse(saved) as Field[]);
  }, [saved]);

  const movable = editable && data?.origin === "added";
  const dirty = useMemo(
    () => Boolean(saved && fields && JSON.stringify(fields) !== saved),
    [saved, fields],
  );
  const options = data ? sourceOptions(data.sources) : [];

  const change = (fieldName: string, patch: Partial<Field>) =>
    setFields((all) => all?.map((f) => (f.name === fieldName ? { ...f, ...patch } : f)) ?? null);

  function addBox(page: number, rect: Rect) {
    setFields((all) => {
      const list = all ?? [];
      const taken = new Set(list.map((f) => f.name));
      let n = list.length + 1;
      while (taken.has(`field_${n}`)) n++;
      const field: Field = {
        name: `field_${n}`,
        type: "text",
        page,
        rect,
        label: "New field",
        source: null,
        format: "text",
        hint: "",
      };
      setSelected(field.name);
      return [...list, field];
    });
    setAdding(false);
  }

  function startOver() {
    if (
      data?.fillable &&
      !window.confirm(
        "Start over? Claude reads the form again, and the fields, sources and hints are replaced.",
      )
    ) {
      return;
    }
    setUp.mutate(
      { fileId },
      { onSuccess: () => toast.success("Claude is reading the form. This takes a minute or two.") },
    );
  }

  function submit() {
    if (!fields) return;
    setError(null);
    save.mutate(
      {
        fileId,
        fields: fields.map((f) => ({
          name: f.name,
          label: f.label.trim() || f.name,
          source: f.source,
          format: f.format,
          hint: f.hint,
          type: f.type,
          page: f.page,
          rect: f.rect,
          multiline: f.multiline,
        })),
      },
      {
        onSuccess: () => toast.success(`${name} saved`),
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Dialog
      open
      full
      onClose={() => {
        if (!dirty || window.confirm("Leave without saving your changes?")) onClose();
      }}
      title={`Fields of ${name}`}
      description="Where each value comes from when EzVisa fills this form for a case. A person checks every filled form."
    >
      {!data ? (
        <div aria-busy="true" className="h-96 animate-pulse rounded-3xl bg-bg" />
      ) : !data.canFill ? (
        <Empty>Only PDFs can be filled. Attach the form as a PDF.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {data.settingUp ? (
              <Chip tone="info" icon="sparkle">
                Claude is reading the form
              </Chip>
            ) : data.fillable ? (
              <Chip tone="ok" icon="check">
                {data.fields.length} fields
              </Chip>
            ) : (
              <Chip tone="warn">Not set up yet</Chip>
            )}
            {data.origin && (
              <span className="text-sm text-muted">
                {data.origin === "added"
                  ? "EzVisa added these boxes to the scan: drag to move, pull the corner to resize."
                  : "The PDF's own form fields."}
              </span>
            )}
            <span className="flex-1" />
            {editable && (
              <Button
                variant={data.fillable ? "ghost" : "primary"}
                icon="sparkle"
                pending={setUp.isPending || data.settingUp}
                onClick={startOver}
              >
                {data.fillable ? "Start over" : "Set up with Claude"}
              </Button>
            )}
            {movable && (
              <Button
                variant={adding ? "primary" : "outline"}
                icon="plus"
                onClick={() => setAdding((a) => !a)}
              >
                {adding ? "Draw the box on the page" : "Add a box"}
              </Button>
            )}
            {editable && data.fillable && (
              <Button pending={save.isPending} disabled={!dirty} onClick={submit}>
                Save
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.bad}`}>
              {error}
            </p>
          )}
          {data.settingUp && !data.fillable ? (
            <Empty>
              Claude is finding the blanks and working out what goes in each. This takes a minute or
              two; you can close this and come back.
            </Empty>
          ) : !data.fillable ? (
            <Empty>
              {editable
                ? "Set the form up: Claude finds its fields (or the blanks on a scan) and maps each one to the client's record or documents."
                : "This form is not set up for filling yet. Ask someone who edits templates."}
            </Empty>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className="lg:sticky lg:top-0">
                {url && (
                  <PdfPages
                    url={url}
                    overlay={(page, scale, size) => (
                      <FieldBoxes
                        scale={scale}
                        size={size}
                        fields={(fields ?? []).filter((f) => f.page === page)}
                        selected={selected}
                        movable={movable}
                        adding={adding}
                        onSelect={setSelected}
                        onMove={(fieldName, rect) => change(fieldName, { rect })}
                        onAdd={(rect) => addBox(page, rect)}
                      />
                    )}
                  />
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {(fields ?? []).map((f) => (
                  <FieldEditor
                    key={f.name}
                    field={f}
                    options={options}
                    formats={data.formats}
                    selected={selected === f.name}
                    editable={editable}
                    removable={movable}
                    onSelect={() => setSelected(f.name)}
                    onChange={(patch) => change(f.name, patch)}
                    onRemove={() => {
                      setFields((all) => all?.filter((x) => x.name !== f.name) ?? null);
                      setSelected(null);
                    }}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function FieldEditor({
  field,
  options,
  formats,
  selected,
  editable,
  removable,
  onSelect,
  onChange,
  onRemove,
}: {
  field: Field;
  options: Array<{ value: string; label: string }>;
  formats: TemplateForm["formats"];
  selected: boolean;
  editable: boolean;
  removable: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<Field>) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the inputs inside take the keyboard
    <li
      ref={ref}
      onClick={onSelect}
      className={`rounded-2xl border p-3 ${selected ? "border-ink bg-soft/40" : "border-line bg-white"}`}
    >
      <div className="flex items-center gap-2">
        <input
          aria-label="Label"
          value={field.label}
          disabled={!editable}
          onChange={(e) => onChange({ label: e.target.value })}
          className={`h-10 flex-1 font-bold ${INPUT}`}
        />
        <span className="text-xs text-muted">p. {field.page + 1}</span>
        {removable && (
          <IconButton
            icon="trash"
            label={`Remove ${field.label}`}
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          />
        )}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <select
          aria-label="Value from"
          value={field.source ?? ""}
          disabled={!editable}
          onChange={(e) => onChange({ source: e.target.value || null })}
          className={`h-10 cursor-pointer ${INPUT}`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.type === "text" && (
          <select
            aria-label="Written as"
            value={field.format}
            disabled={!editable}
            onChange={(e) => onChange({ format: e.target.value })}
            className={`h-10 cursor-pointer ${INPUT}`}
          >
            {formats.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {(selected || field.hint) && (
        <input
          aria-label="Hint"
          placeholder="A hint for whoever fills it"
          value={field.hint}
          disabled={!editable}
          onChange={(e) => onChange({ hint: e.target.value })}
          className={`mt-2 h-10 ${INPUT}`}
        />
      )}
    </li>
  );
}

type Drag = {
  kind: "move" | "resize" | "draw";
  name?: string;
  startX: number;
  startY: number;
  rect: Rect;
};

/** The fields of one page, drawn over it; on a scan EzVisa made fillable, editable. */
function FieldBoxes({
  scale,
  size,
  fields,
  selected,
  movable,
  adding,
  onSelect,
  onMove,
  onAdd,
}: {
  scale: number;
  size: PageSize;
  fields: Field[];
  selected: string | null;
  movable: boolean;
  adding: boolean;
  onSelect: (name: string) => void;
  onMove: (name: string, rect: Rect) => void;
  onAdd: (rect: Rect) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);

  const clampRect = ([x, y, w, h]: Rect): Rect => {
    const width = Math.min(Math.max(w, MIN), size.width);
    const height = Math.min(Math.max(h, MIN), size.height);
    return [
      Math.min(Math.max(x, 0), size.width - width),
      Math.min(Math.max(y, 0), size.height - height),
      width,
      height,
    ];
  };

  /** Page point (PDF coordinates, from the bottom-left) under the pointer. */
  const pointAt = (e: ReactPointerEvent) => {
    const box = layer.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: (e.clientX - box.left) / scale, y: size.height - (e.clientY - box.top) / scale };
  };

  function begin(e: ReactPointerEvent, next: Drag) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag(next);
  }

  function moveTo(e: ReactPointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    const [x, y, w, h] = drag.rect;
    if (drag.kind === "move") setPreview(clampRect([x + dx, y - dy, w, h]));
    if (drag.kind === "resize") setPreview(clampRect([x, y - dy, w + dx, h + dy]));
    if (drag.kind === "draw") {
      const left = Math.min(x, x + dx);
      const top = Math.max(y, y - dy);
      setPreview([left, top - Math.abs(dy), Math.abs(dx), Math.abs(dy)]);
    }
  }

  function end() {
    if (!drag) return;
    if (drag.kind === "draw") {
      // A click without a drag places a box of a usual size.
      const [x, y] = drag.rect;
      const drawn = preview && preview[2] > MIN && preview[3] > MIN ? preview : [x, y - 9, 160, 18];
      onAdd(clampRect(drawn as Rect));
    } else if (preview && drag.name) {
      onMove(drag.name, preview.map((n) => Math.round(n * 10) / 10) as Rect);
    }
    setDrag(null);
    setPreview(null);
  }

  return (
    <div
      ref={layer}
      className={`absolute inset-0 ${adding ? "cursor-crosshair" : ""}`}
      onPointerDown={(e) => {
        if (!adding) return;
        const p = pointAt(e);
        begin(e, { kind: "draw", startX: e.clientX, startY: e.clientY, rect: [p.x, p.y, 0, 0] });
      }}
      onPointerMove={moveTo}
      onPointerUp={end}
      onPointerCancel={() => {
        setDrag(null);
        setPreview(null);
      }}
    >
      {fields.map((f) => {
        const rect = drag?.name === f.name && preview ? preview : (f.rect as Rect);
        const on = selected === f.name;
        return (
          <button
            type="button"
            key={f.name}
            aria-label={f.label}
            title={f.label}
            onClick={() => onSelect(f.name)}
            onPointerDown={(e) => {
              onSelect(f.name);
              if (movable && !adding) {
                begin(e, {
                  kind: "move",
                  name: f.name,
                  startX: e.clientX,
                  startY: e.clientY,
                  rect: f.rect as Rect,
                });
              }
            }}
            className={`absolute rounded-[3px] border ${
              on
                ? "z-10 border-ink bg-accent/25"
                : "border-accent/70 bg-accent/10 hover:bg-accent/20"
            } ${movable && !adding ? "cursor-move touch-none" : "cursor-pointer"}`}
            style={boxStyle(rect, scale, size)}
          >
            {on && (
              <span className="pointer-events-none absolute -top-5 left-0 max-w-48 truncate rounded bg-ink px-1.5 text-[10px] font-bold leading-4 text-white">
                {f.label}
              </span>
            )}
            {on && movable && !adding && (
              <span
                aria-hidden="true"
                onPointerDown={(e) =>
                  begin(e, {
                    kind: "resize",
                    name: f.name,
                    startX: e.clientX,
                    startY: e.clientY,
                    rect: f.rect as Rect,
                  })
                }
                className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize touch-none rounded-sm border border-white bg-ink"
              />
            )}
          </button>
        );
      })}
      {drag?.kind === "draw" && preview && (
        <div
          className="pointer-events-none absolute rounded-[3px] border border-dashed border-ink bg-accent/20"
          style={boxStyle(preview, scale, size)}
        />
      )}
      {adding && fields.length === 0 && (
        <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">
          <Icon name="plus" size={12} /> Draw a box
        </span>
      )}
    </div>
  );
}

/** A PDF rectangle (from the bottom-left, in points) placed over the drawn page. */
export function boxStyle([x, y, w, h]: Rect | number[], scale: number, size: PageSize) {
  return {
    left: (x ?? 0) * scale,
    top: (size.height - (y ?? 0) - (h ?? 0)) * scale,
    width: (w ?? 0) * scale,
    height: (h ?? 0) * scale,
  };
}
