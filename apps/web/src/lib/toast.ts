import { useSyncExternalStore } from "react";

export type Toast = { id: number; kind: "success" | "error"; message: string };

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function push(kind: Toast["kind"], message: string) {
  const id = nextId++;
  toasts = [...toasts.filter((t) => t.message !== message), { id, kind, message }].slice(-3);
  emit();
  setTimeout(() => dismissToast(id), kind === "error" ? 8000 : 4000);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Short messages at the bottom of the screen. Callable from outside React. */
export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
  );
}
