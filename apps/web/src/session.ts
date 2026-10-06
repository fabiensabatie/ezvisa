/** Exchanges a token for a session cookie. The token is not kept in the browser. */
export async function signIn(
  token: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: body.error ?? "Sign-in failed. Try again." };
  } catch {
    return { ok: false, message: "The server cannot be reached. Check your connection." };
  }
}

export async function signOut(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" }).catch(() => undefined);
}
