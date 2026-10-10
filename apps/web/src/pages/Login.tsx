import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Flower } from "../components/Flower";
import { Icon } from "../components/Icon";
import { signIn } from "../session";
import { ThemeProvider } from "../theme";

const PETALS: Array<[number, number]> = [
  [50, 24],
  [74.7, 42],
  [65.3, 71],
  [34.7, 71],
  [25.3, 42],
];

function Bloom({ className, petal, center }: { className: string; petal: string; center: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      className={`pointer-events-none absolute ${className}`}
    >
      {PETALS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={19} className={petal} />
      ))}
      <circle cx={50} cy={50} r={12} className={center} />
    </svg>
  );
}

/** After sign-in, an OAuth consent request (from an MCP connector) resumes on the server. */
function oauthReturnPath(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  return next?.startsWith("/authorize?") ? next : null;
}

function LoginForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setError("Paste your access token to continue.");
      return;
    }
    setBusy(true);
    const result = await signIn(token.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setToken("");
    queryClient.clear();
    const next = oauthReturnPath();
    if (next) {
      window.location.assign(next);
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-10">
      <Bloom
        className="-left-32 -top-36 size-[440px]"
        petal="fill-petal-light"
        center="fill-soft-2"
      />
      <Bloom className="-bottom-28 -right-20 size-80" petal="fill-soft-2" center="fill-petal" />
      <Bloom
        className="right-[14%] top-[12%] size-24"
        petal="fill-petal-light"
        center="fill-white"
      />

      <div className="relative w-full max-w-md rounded-[32px] border border-line bg-white px-8 pb-8 pt-10 shadow-lift sm:px-9">
        <div className="flex items-center gap-3">
          <Flower size={46} />
          <div>
            <div className="font-display text-2xl font-semibold leading-none">EzVisa</div>
            <div className="mt-1 text-sm text-muted">Chiang Mai visa desk</div>
          </div>
        </div>
        <h1 className="mt-8 font-display text-3xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-text-soft">
          {oauthReturnPath()
            ? "Sign in with your access token to connect an app to EzVisa."
            : "Sign in with your access token to open today’s cases."}
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-2.5" noValidate>
          <label htmlFor="token" className="text-sm font-extrabold">
            Access token
          </label>
          <input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ezv_live_…"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? "token-error" : undefined}
            className={`h-13 rounded-2xl border-2 bg-bg px-4 font-mono outline-none focus:border-accent ${error ? "border-[#A32A2A]" : "border-line"}`}
          />
          {error && (
            <p id="token-error" role="alert" className="text-sm font-bold text-[#A32A2A]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 min-h-13 cursor-pointer rounded-full bg-ink font-extrabold text-white disabled:opacity-70"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-6 flex items-start gap-3 rounded-2xl bg-soft px-4 py-3.5 text-ink">
          <Icon name="key" className="mt-0.5" />
          <p className="text-sm leading-relaxed text-text-soft">
            Tokens are issued by the owner from Settings. The same token signs you in here and
            authorises the MCP server, so keep it private.
          </p>
        </div>
      </div>
    </main>
  );
}

export function LoginPage() {
  return (
    <ThemeProvider>
      <LoginForm />
    </ThemeProvider>
  );
}
