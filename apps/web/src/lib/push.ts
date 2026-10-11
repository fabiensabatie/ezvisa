// Web Push in the browser: a service worker (public/sw.js) receives the messages and shows
// them, even when no EzVisa tab is open.

export type PushSupport =
  | "supported"
  /** iPhone or iPad in Safari: push works only from the app added to the Home Screen. */
  | "needs-home-screen"
  | "unsupported";

export function pushSupport(): PushSupport {
  const capable =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
  if (capable) return "supported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  return ios && !standalone ? "needs-home-screen" : "unsupported";
}

/** The VAPID public key is base64url; the Push API wants raw bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** This browser's current subscription, if any. Never prompts. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export type SubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

/**
 * Asks for permission (call it from a click: browsers ignore prompts that are not), then
 * subscribes this browser and returns what the server needs to store.
 */
export async function enablePush(publicKey: string): Promise<SubscriptionPayload> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in the browser's site settings."
        : "Notifications were not allowed.",
    );
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser returned an incomplete subscription. Try again.");
  }
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 300),
  };
}

/** Unsubscribes this browser. Returns the endpoint so the server can forget it too. */
export async function disablePush(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
