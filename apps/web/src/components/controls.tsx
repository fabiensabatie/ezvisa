import {
  type ButtonHTMLAttributes,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from "react";
import { Icon, type IconName } from "./Icon";

// ---- buttons -----------------------------------------------------------------

const VARIANTS = {
  primary: "bg-ink text-white",
  soft: "bg-soft text-ink",
  outline: "border border-line bg-white text-ink",
  danger: "border border-line bg-white text-[#A32A2A]",
  ghost: "text-text-soft hover:bg-bg",
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

export function Button({
  variant = "primary",
  icon,
  pending = false,
  className = "",
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: IconName;
  pending?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-extrabold transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {pending ? (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icon && <Icon name={icon} size={17} />
      )}
      {children}
    </button>
  );
}

/** A square icon-only button. The label is read by screen readers and shown as a tooltip. */
export function IconButton({
  icon,
  label,
  variant = "outline",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}

// ---- dialog ------------------------------------------------------------------

/**
 * A modal on the native <dialog> element: focus is trapped, Escape closes it and the
 * rest of the page is inert while it is open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={`m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] overflow-y-auto rounded-3xl border border-line bg-white p-0 text-text shadow-card backdrop:bg-[#2a1a24]/35 ${wide ? "max-w-2xl" : "max-w-lg"}`}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="font-display text-xl font-semibold">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <IconButton icon="close" label="Close" variant="ghost" onClick={onClose} />
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** A dialog holding a form, with Cancel and a submit button. */
export function FormDialog({
  open,
  onClose,
  title,
  description,
  submitLabel,
  submitVariant = "primary",
  pending,
  error,
  onSubmit,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  submitLabel: string;
  submitVariant?: ButtonVariant;
  pending?: boolean;
  error?: string | null;
  onSubmit: () => void;
  children?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} wide={wide}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        {children}
        {error && (
          <p
            role="alert"
            className="rounded-2xl bg-[#FFF5F5] px-3.5 py-3 text-sm font-bold text-[#A32A2A]"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={submitVariant} pending={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---- fields ------------------------------------------------------------------

export const INPUT =
  "w-full rounded-2xl border border-line bg-white px-3.5 text-sm text-text outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-soft";

function FieldShell({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-extrabold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  hint,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`h-11 ${INPUT} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  className = "",
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <textarea
        id={id}
        rows={3}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`py-2.5 leading-relaxed ${INPUT} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  options,
  className = "",
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode;
  hint?: ReactNode;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <select
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`h-11 cursor-pointer ${INPUT} ${className}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-bg px-3.5 py-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--ezv-ink)]"
      />
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-extrabold">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/** A set of mutually exclusive choices shown as cards, each with an explanation. */
export function RadioCards<T extends string>({
  legend,
  value,
  onChange,
  options,
}: {
  legend: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; description?: string; disabled?: boolean }>;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-extrabold">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border px-3.5 py-3 ${
                on ? "border-ink bg-soft" : "border-line bg-white"
              } ${o.disabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={on}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ezv-ink)]"
              />
              <span>
                <span className="block text-sm font-extrabold">{o.label}</span>
                {o.description && (
                  <span className="mt-0.5 block text-xs text-muted">{o.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Two fields side by side from the small breakpoint up. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

/** Empty strings become undefined, so optional fields are left out of the request. */
export function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Empty strings become null, which clears the field on update. */
export function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
