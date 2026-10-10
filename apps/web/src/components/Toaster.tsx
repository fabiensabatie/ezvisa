import { dismissToast, useToasts } from "../lib/toast";
import { Icon } from "./Icon";

export function Toaster() {
  const toasts = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl px-4 py-3 text-sm font-bold shadow-card ${
            t.kind === "error"
              ? "border border-[#F5C2C2] bg-[#FFF5F5] text-[#A32A2A]"
              : "bg-ink text-white"
          }`}
        >
          <Icon name={t.kind === "error" ? "alert" : "check"} size={18} className="mt-px" />
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="-m-1 grid size-7 cursor-pointer place-items-center rounded-lg opacity-70 hover:opacity-100"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
