"use client";

// Lightweight i18n for tap-app.
//
// Why not next-intl / next-i18next?
//   next-intl is the standard for App Router but the recommended setup
//   forces a `/[locale]/…` URL structure. That would require moving every
//   admin + POS + public route, updating every internal link, and adding
//   middleware — a much larger blast radius than the value delivered
//   right now. This lightweight setup stores the locale in localStorage,
//   flips the entire tree with a `useT()` hook, and lets us adopt a
//   heavier framework later without breaking anything.
//
// Contract:
//   - t("nav.dashboard") — returns the translated string or the key
//     itself if missing, so untranslated UI is obvious instead of blank.
//   - t("nav.dashboard", { defaultValue: "..." }) — falls back to the
//     default if the key doesn't exist rather than showing the key.
//   - Interpolation: t("greeting", { name: "Alex" }) with a message
//     "Hello {name}" resolves to "Hello Alex". Missing tokens are left
//     as-is so bugs are visible in QA.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import en from "./dictionaries/en.json";
import fr from "./dictionaries/fr.json";

export type Locale = "en" | "fr";

const DICTIONARIES: Record<Locale, Record<string, any>> = {
  en,
  fr,
};

const STORAGE_KEY = "tap_locale";
const DEFAULT_LOCALE: Locale = "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, opts?: { defaultValue?: string; [k: string]: any }) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Look up dot-path key inside a nested object. Missing → undefined.
function resolve(dict: Record<string, any>, key: string): any {
  return key.split(".").reduce<any>((acc, k) => (acc ? acc[k] : undefined), dict);
}

function interpolate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Start on default and rehydrate from localStorage after mount so the
  // server-rendered markup matches the initial client render (no hydration
  // mismatch). One extra render after mount is acceptable for a locale flip.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "fr") {
        setLocaleState(stored);
      } else {
        // Auto-detect from browser once, then persist. Only pick FR if the
        // preferred browser language explicitly starts with "fr" — avoids
        // silently switching langue for anglophones who never asked.
        const nav = typeof navigator !== "undefined" ? navigator.language : "";
        if (nav.toLowerCase().startsWith("fr")) {
          setLocaleState("fr");
          window.localStorage.setItem(STORAGE_KEY, "fr");
        }
      }
    } catch {
      /* localStorage unavailable — stay on default */
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    // Update <html lang> so screen readers + browser features pick the
    // right pronunciation / spellcheck.
    if (typeof document !== "undefined") {
      document.documentElement.lang = l === "fr" ? "fr-CA" : "en";
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "fr" ? "fr-CA" : "en";
    }
  }, [locale]);

  const t = useCallback(
    (
      key: string,
      opts?: { defaultValue?: string; [k: string]: any }
    ): string => {
      const dict = DICTIONARIES[locale] || DICTIONARIES[DEFAULT_LOCALE];
      let value = resolve(dict, key);
      // Fall back to English if the current locale is missing the key —
      // partial translations still render sensibly.
      if (value === undefined && locale !== DEFAULT_LOCALE) {
        value = resolve(DICTIONARIES[DEFAULT_LOCALE], key);
      }
      if (typeof value !== "string") {
        return opts?.defaultValue ?? key;
      }
      if (opts) {
        const { defaultValue: _dv, ...vars } = opts;
        if (Object.keys(vars).length > 0) return interpolate(value, vars);
      }
      return value;
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Convenience hook. Returns t() + the current locale + setter.
 * Safe to call outside a provider — falls back to English identity
 * behaviour so tests / storybooks don't need to wrap.
 */
export function useT() {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  };
}
