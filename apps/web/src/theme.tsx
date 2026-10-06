import { applyTheme, DEFAULT_ACCENT, normalizeHex } from "@ezvisa/ui";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

const KEY = "ezv.accent";

/** The accent this browser chose, if any. Storage can be unavailable, so never throw. */
export function storedAccent(): string | null {
  try {
    return normalizeHex(localStorage.getItem(KEY) ?? "");
  } catch {
    return null;
  }
}

function store(hex: string | null) {
  try {
    if (hex) localStorage.setItem(KEY, hex);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the choice lasts until reload.
  }
}

type ThemeState = {
  accent: string;
  /** The organisation's accent, from Settings. */
  orgAccent: string;
  /** True when this browser overrides the organisation's accent. */
  overridden: boolean;
  setAccent: (hex: string | null) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({
  orgAccent,
  children,
}: {
  orgAccent?: string;
  children: ReactNode;
}) {
  const [override, setOverride] = useState<string | null>(storedAccent);
  const org = normalizeHex(orgAccent ?? "") ?? DEFAULT_ACCENT.toLowerCase();
  const accent = override ?? org;

  useEffect(() => {
    applyTheme(accent);
  }, [accent]);

  const value = useMemo<ThemeState>(
    () => ({
      accent,
      orgAccent: org,
      overridden: override !== null,
      setAccent: (hex) => {
        const next = hex ? normalizeHex(hex) : null;
        store(next);
        setOverride(next);
      },
    }),
    [accent, org, override],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme needs a ThemeProvider");
  return state;
}
