import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { currentSubscription, disablePush, enablePush, pushSupport } from "../lib/push";
import { toast } from "../lib/toast";
import { TONE } from "../lib/tones";
import { errorMessage, useTRPC } from "../trpc";
import { Button } from "./controls";
import { Card, CardTitle, Chip } from "./ui";

/** Turns reminder notifications on or off for this browser. */
export function NotificationsCard() {
  const trpc = useTRPC();
  const support = pushSupport();
  // undefined while the browser is being asked; null when it is not subscribed.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    currentSubscription()
      .then((s) => setEndpoint(s?.endpoint ?? null))
      .catch(() => setEndpoint(null));
  }, []);

  const config = useQuery({
    ...trpc.notifications.config.queryOptions(),
    enabled: support === "supported",
  });
  const status = useQuery({
    ...trpc.notifications.status.queryOptions({ endpoint: endpoint ?? "" }),
    enabled: Boolean(endpoint),
  });
  const subscribe = useMutation(
    trpc.notifications.subscribe.mutationOptions({ meta: { quiet: true } }),
  );
  const unsubscribe = useMutation(
    trpc.notifications.unsubscribe.mutationOptions({ meta: { quiet: true } }),
  );
  const test = useMutation(trpc.notifications.test.mutationOptions());

  const on = Boolean(endpoint) && status.data?.subscribed === true;
  const blocked = support === "supported" && Notification.permission === "denied";

  async function turnOn() {
    if (!config.data) return;
    setBusy(true);
    try {
      const payload = await enablePush(config.data.publicKey);
      await subscribe.mutateAsync(payload);
      setEndpoint(payload.endpoint);
      toast.success("Notifications are on for this device");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const gone = await disablePush();
      if (gone) await unsubscribe.mutateAsync({ endpoint: gone });
      setEndpoint(null);
      toast.success("Notifications are off for this device");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle
        icon={{ name: "bell" }}
        sub="At 08:00, when reminders are due to send, EzVisa notifies this device, even when the dashboard is closed. Turn it on in each browser or phone you use."
        aside={on ? <Chip tone="ok">On for this device</Chip> : undefined}
      >
        Notifications
      </CardTitle>
      {support === "needs-home-screen" ? (
        <p className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.info}`}>
          On iPhone and iPad, add EzVisa to the Home Screen first: tap Share, then Add to Home
          Screen. Open EzVisa from that icon and turn notifications on here.
        </p>
      ) : support === "unsupported" ? (
        <p className="rounded-2xl bg-bg px-3.5 py-3 text-sm text-text-soft">
          This browser cannot receive notifications.
        </p>
      ) : blocked ? (
        <p className={`rounded-2xl px-3.5 py-3 text-sm font-bold ${TONE.warn}`}>
          Notifications are blocked for this site. Allow them in the browser's site settings, then
          come back here.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {on ? (
            <>
              <Button
                variant="outline"
                icon="send"
                pending={test.isPending}
                onClick={() =>
                  test.mutate(undefined, {
                    onSuccess: (r) =>
                      toast.success(
                        r.sent > 0
                          ? "Test sent. It should appear in a few seconds."
                          : "The test could not be delivered. Turn notifications off and on again.",
                      ),
                  })
                }
              >
                Send a test
              </Button>
              <Button variant="ghost" pending={busy} onClick={turnOff}>
                Turn off
              </Button>
            </>
          ) : (
            <Button
              icon="bell"
              pending={busy || endpoint === undefined || config.isPending}
              disabled={!config.data}
              onClick={turnOn}
            >
              Turn on notifications
            </Button>
          )}
        </div>
      )}
      {config.error && <p className="mt-2 text-sm text-muted">{errorMessage(config.error)}</p>}
    </Card>
  );
}
