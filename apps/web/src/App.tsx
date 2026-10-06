import { applyTheme, DEFAULT_ACCENT, THEME_PRESETS } from "@ezvisa/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Flower } from "./Flower";
import { useTRPC } from "./trpc";

/**
 * M0 placeholder. Proves the chain browser → tRPC → server and the theme engine.
 * The real screens from the mockup arrive in M2.
 */
export function App() {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.queryOptions());
  const [accent, setAccent] = useState(DEFAULT_ACCENT);

  const pick = (hex: string) => {
    setAccent(hex);
    applyTheme(hex);
  };

  const status = health.isPending
    ? { label: "Checking the server…", dot: "bg-soft-2" }
    : health.isError
      ? { label: "Server unreachable", dot: "bg-red-700" }
      : {
          label: `Server connected at ${new Date(health.data.time).toLocaleTimeString()}`,
          dot: "bg-emerald-600",
        };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-[32px] border border-line bg-white p-9 shadow-lift">
        <div className="flex items-center gap-3">
          <Flower />
          <div>
            <p className="font-display text-2xl font-semibold leading-none">EzVisa</p>
            <p className="mt-1 text-sm text-muted">Chiang Mai visa desk</p>
          </div>
        </div>

        <h1 className="mt-8 font-display text-3xl font-semibold">The scaffold is running</h1>
        <p className="mt-2 text-text-soft">
          Milestone M0. Sign-in, cases and clients arrive in the next milestones.
        </p>

        <p
          role="status"
          className="mt-6 flex items-center gap-3 rounded-2xl bg-soft px-4 py-3 text-sm font-bold text-ink"
        >
          <span className={`size-2.5 shrink-0 rounded-full ${status.dot}`} />
          {status.label}
        </p>

        <fieldset className="mt-6">
          <legend className="text-sm font-extrabold">Theme colour</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {THEME_PRESETS.map((preset) => (
              <button
                key={preset.hex}
                type="button"
                aria-label={`Use the ${preset.name} theme`}
                aria-pressed={accent === preset.hex}
                onClick={() => pick(preset.hex)}
                className="grid size-11 cursor-pointer place-items-center rounded-full"
              >
                <span
                  className="size-7 rounded-full"
                  style={{
                    background: preset.hex,
                    boxShadow:
                      accent === preset.hex ? `0 0 0 3px #fff, 0 0 0 5px ${preset.hex}` : "none",
                  }}
                />
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          className="mt-8 min-h-12 w-full cursor-pointer rounded-full bg-ink font-extrabold text-white"
          onClick={() => void health.refetch()}
        >
          Check again
        </button>
      </section>
    </main>
  );
}
