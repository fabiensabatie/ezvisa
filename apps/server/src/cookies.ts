/** Minimal cookie helpers: the server only ever reads and writes the session cookie. */

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null; // Malformed percent-encoding: treat as signed out.
      }
    }
  }
  return null;
}

export function sessionCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number; secure: boolean },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds}`,
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}
