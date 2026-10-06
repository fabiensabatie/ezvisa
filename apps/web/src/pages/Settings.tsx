import { THEME_PRESETS } from "@ezvisa/ui";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "../components/Icon";
import { Card, CardTitle, Chip, Label, PageHeader, QueryView } from "../components/ui";
import { useTheme } from "../theme";
import { useTRPC } from "../trpc";

/** In development the dashboard runs on Vite's port; the MCP server is on the API port. */
function mcpEndpoint(): string {
  const { protocol, hostname, port, origin } = window.location;
  return port === "5173" ? `${protocol}//${hostname}:3000/mcp` : `${origin}/mcp`;
}

function Theme() {
  const { accent, orgAccent, overridden, setAccent } = useTheme();
  return (
    <Card>
      <CardTitle
        icon={{ name: "heart" }}
        sub="Your choice applies to this browser. Tints, buttons and text shades are derived from it and kept readable."
      >
        Theme colour
      </CardTitle>
      <div className="flex flex-wrap items-start gap-2">
        {THEME_PRESETS.map((p) => {
          const on = accent === p.hex.toLowerCase();
          return (
            <button
              key={p.hex}
              type="button"
              aria-pressed={on}
              onClick={() => setAccent(p.hex)}
              className={`flex min-w-20 cursor-pointer flex-col items-center gap-2 rounded-2xl px-2 py-3 ${on ? "bg-bg" : ""}`}
            >
              <span
                className="grid size-12 place-items-center rounded-full text-white"
                style={{
                  background: p.hex,
                  boxShadow: on ? `0 0 0 3px #fff, 0 0 0 5px ${p.hex}` : undefined,
                }}
              >
                {on && <Icon name="check" strokeWidth={3} />}
              </span>
              <span className="text-sm font-extrabold">{p.name}</span>
            </button>
          );
        })}
        <label className="flex min-w-20 cursor-pointer flex-col items-center gap-2 px-2 py-3">
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="size-12 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          <span className="text-sm font-extrabold">Custom</span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-bg p-4">
        <span className="text-xs font-extrabold uppercase tracking-wide text-muted">Preview</span>
        <span className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 font-extrabold text-white">
          Primary
        </span>
        <span className="inline-flex min-h-11 items-center rounded-full bg-soft px-5 font-extrabold text-ink">
          Secondary
        </span>
        <Chip tone="accent">Drafting</Chip>
        <span className="font-mono text-sm text-text-soft">{accent}</span>
        {overridden && (
          <button
            type="button"
            onClick={() => setAccent(null)}
            className="ml-auto min-h-11 cursor-pointer rounded-full border border-line bg-white px-4 text-sm font-extrabold text-ink"
          >
            Use the agency colour ({orgAccent})
          </button>
        )}
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  const endpoint = mcpEndpoint();

  return (
    <>
      <PageHeader title="Settings" subtitle="Theme, your access and the MCP server" />
      <div className="flex flex-col gap-5">
        <Theme />
        <QueryView query={me} what="your account">
          {(m) => (
            <div className="grid items-start gap-5 xl:grid-cols-2">
              <Card>
                <CardTitle icon={{ name: "key" }}>Your access</CardTitle>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Signed in as</Label>
                    <div className="mt-1 font-bold">{m.name}</div>
                  </div>
                  <div>
                    <Label>Role</Label>
                    <div className="mt-1 font-bold">{m.role}</div>
                  </div>
                  <div>
                    <Label>Token</Label>
                    <div className="mt-1 font-bold">{m.token?.label ?? "Unknown"}</div>
                  </div>
                  <div>
                    <Label>Can approve packs</Label>
                    <div className="mt-1">
                      <Chip tone={m.permissions.approvePacks ? "ok" : "mute"}>
                        {m.permissions.approvePacks ? "Yes" : "No"}
                      </Chip>
                    </div>
                  </div>
                </div>
              </Card>
              <Card>
                <CardTitle
                  icon={{ name: "sparkle" }}
                  sub="Claude and other MCP clients connect with a token and get exactly the permissions of its role."
                >
                  MCP server
                </CardTitle>
                <Label>Endpoint</Label>
                <div className="mt-1.5 break-all rounded-2xl bg-bg px-3.5 py-3 font-mono text-sm">
                  {endpoint}
                </div>
                <div className="mt-4">
                  <Label>Connect Claude Code</Label>
                </div>
                <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-2xl bg-bg px-3.5 py-3 font-mono text-xs leading-relaxed">
                  {`claude mcp add --transport http ezvisa ${endpoint} --header "Authorization: Bearer <token>"`}
                </pre>
              </Card>
            </div>
          )}
        </QueryView>
      </div>
    </>
  );
}
