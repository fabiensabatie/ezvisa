import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCan } from "../lib/can";
import { plural } from "../lib/format";
import { toast } from "../lib/toast";
import { TONE } from "../lib/tones";
import { type Outputs, useTRPC } from "../trpc";
import { Button, CheckboxField, INPUT } from "./controls";
import { Icon } from "./Icon";
import { Card, CardTitle, Chip, QueryView } from "./ui";

type Overview = Outputs["chat"]["overview"];

function Notes({ data, canEdit }: { data: Overview; canEdit: boolean }) {
  const trpc = useTRPC();
  const save = useMutation(trpc.chat.updateSettings.mutationOptions());
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? data.instructions;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { instructions: value },
          {
            onSuccess: () => {
              setDraft(null);
              toast.success("Every agent uses these notes from its next reply");
            },
          },
        );
      }}
    >
      <label htmlFor="chat-notes" className="text-sm font-extrabold">
        What every agent should know
      </label>
      <textarea
        id="chat-notes"
        rows={6}
        maxLength={8000}
        readOnly={!canEdit}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          "Office hours: Mon–Fri 9:00–17:00, Sat 9:00–12:00.\nAddress and map link.\nPrices: retirement extension 1,900 THB government fee + our service fee of …\nWe answer in English and Thai."
        }
        className={`min-h-36 p-3.5 text-sm ${INPUT}`}
      />
      <p className="text-xs text-muted">
        Hours, address, prices and policies, for every agent. Without a price here, agents pass
        price questions to the team. Each agent's own instructions are on the Agents page.
      </p>
      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" pending={save.isPending} disabled={value === data.instructions}>
            Save notes
          </Button>
        </div>
      )}
    </form>
  );
}

/** The shared inbox (Chatwoot): connection, the notes every agent reads, pause, usage. */
export function ChatSettingsCard() {
  const trpc = useTRPC();
  const { can } = useCan();
  const canEdit = can("settings", "edit");
  const overview = useQuery(trpc.chat.overview.queryOptions());
  const save = useMutation(trpc.chat.updateSettings.mutationOptions());

  return (
    <Card>
      <CardTitle
        icon={{ name: "message" }}
        sub="LINE, Messenger and WhatsApp arrive in one inbox (Chatwoot). Agents answer first and hand over to the team."
        aside={
          <span className="flex flex-wrap gap-2">
            <Link
              to="/agents"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-extrabold hover:bg-bg"
            >
              <Icon name="sparkle" size={15} /> Agents
            </Link>
            {overview.data?.connection.url && (
              <a
                href={overview.data.connection.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-extrabold hover:bg-bg"
              >
                Chatwoot <Icon name="external" size={15} />
              </a>
            )}
          </span>
        }
      >
        Shared inbox
      </CardTitle>
      <QueryView query={overview} what="the shared inbox">
        {(data) => (
          <div className="flex flex-col gap-4">
            {!data.connection.connected ? (
              <p className={`flex gap-2 rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
                <Icon name="alert" size={17} className="mt-px shrink-0" />
                {data.connection.error ??
                  "Chatwoot is not connected. Set CHATWOOT_URL and CHATWOOT_API_TOKEN (an administrator's access token from Chatwoot's profile settings) on the server."}
              </p>
            ) : (
              !data.modelReady && (
                <p className={`flex gap-2 rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
                  <Icon name="alert" size={17} className="mt-px shrink-0" />
                  ANTHROPIC_API_KEY is not set on the server, so agents hand every conversation to
                  the team.
                </p>
              )
            )}
            <CheckboxField
              label="Agents answer"
              hint="Off pauses every agent at once: new messages wait for the team."
              checked={data.enabled}
              onChange={(enabled) =>
                canEdit &&
                save.mutate(
                  { enabled },
                  {
                    onSuccess: () =>
                      toast.success(enabled ? "Agents are answering" : "Agents are paused"),
                  },
                )
              }
            />
            <Notes data={data} canEdit={canEdit} />
            <div className="flex flex-wrap gap-2">
              <Chip>{plural(data.usage.replies, "reply", "replies")} this month</Chip>
              <Chip>{plural(data.usage.handOffs, "handover")}</Chip>
              <Chip>
                {Math.round((data.usage.tokens.input + data.usage.tokens.cacheRead) / 1000)}k tokens
                in · {Math.round(data.usage.tokens.output / 1000)}k out
              </Chip>
            </div>
          </div>
        )}
      </QueryView>
    </Card>
  );
}
