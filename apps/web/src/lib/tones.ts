export type Tone = "ok" | "warn" | "bad" | "info" | "mute" | "accent";

/** Chip colours. Fixed tones stay readable on any theme; "accent" follows the theme. */
export const TONE: Record<Tone, string> = {
  ok: "bg-[#E2F5EA] text-[#1D6A43]",
  warn: "bg-[#FFF0D2] text-[#8A5700]",
  bad: "bg-[#FDE3E3] text-[#A32A2A]",
  info: "bg-[#E2EEFC] text-[#1C5898]",
  mute: "bg-[#F0EBEE] text-[#5C4D57]",
  accent: "bg-soft text-ink",
};

export const DOT: Record<Tone, string> = {
  ok: "bg-[#1D6A43]",
  warn: "bg-[#8A5700]",
  bad: "bg-[#A32A2A]",
  info: "bg-[#1C5898]",
  mute: "bg-[#5C4D57]",
  accent: "bg-ink",
};

export const STAGES = [
  { key: "NEW", label: "New inquiry", tone: "info" },
  { key: "COLLECTING", label: "Collecting", tone: "warn" },
  { key: "DRAFTING", label: "Drafting", tone: "accent" },
  { key: "VALIDATION", label: "Validation", tone: "accent" },
  { key: "SUBMISSION", label: "Submission", tone: "info" },
  { key: "DONE", label: "Done", tone: "ok" },
  { key: "CANCELLED", label: "Cancelled", tone: "mute" },
] as const satisfies ReadonlyArray<{ key: string; label: string; tone: Tone }>;

export type StageKey = (typeof STAGES)[number]["key"];

export function stage(key: string) {
  return STAGES.find((s) => s.key === key) ?? { key, label: key, tone: "mute" as Tone };
}

export const ITEM_STATUS: Record<string, { label: string; tone: Tone }> = {
  MISSING: { label: "Missing", tone: "mute" },
  RECEIVED: { label: "Received", tone: "info" },
  VERIFIED: { label: "Verified", tone: "ok" },
  FLAGGED: { label: "Flagged", tone: "bad" },
  WAIVED: { label: "Waived", tone: "mute" },
};

export const REMINDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  DUE: { label: "Due now", tone: "bad" },
  SCHEDULED: { label: "Scheduled", tone: "mute" },
  SENT: { label: "Sent", tone: "ok" },
  SKIPPED: { label: "Skipped", tone: "mute" },
  CANCELLED: { label: "Cancelled", tone: "mute" },
};

export const DEADLINE_LABEL: Record<string, string> = {
  STAY_ENDS: "Permission to stay ends",
  REPORT_DUE: "90-day report due",
};

export const CHANNEL_LABEL: Record<string, string> = {
  LINE: "LINE",
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  EMAIL: "Email",
  PHONE: "Phone",
};

export function dueTone(days: number | null | undefined): Tone {
  if (days === null || days === undefined) return "mute";
  if (days <= 3) return "bad";
  if (days <= 10) return "warn";
  return "mute";
}

const PASTELS = ["#FFE0EC", "#E0F0FF", "#E3F6E8", "#EFE4FF", "#FFF0D6"];

/** A stable pastel for an avatar, from any id. */
export function pastelFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PASTELS[hash % PASTELS.length] ?? PASTELS[0] ?? "#FFE0EC";
}
