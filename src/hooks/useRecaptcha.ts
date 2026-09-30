"use client";

// Client-side reCAPTCHA v3 helper — Phase E R5.
//
// Loads the Google reCAPTCHA script once per page load, then exposes an
// `execute(action)` function that returns a token to submit alongside
// the form. Public booking flows call this on final submit.
//
// v3 is invisible — no interstitial for the customer. The score is
// evaluated server-side by verifyRecaptcha() in @/lib/recaptcha.
//
// NEXT_PUBLIC_RECAPTCHA_SITE_KEY must be exposed in the client env.
// When unset, execute() returns "" and the server treats it as a
// missing token — which is fine if the server ALSO has no
// RECAPTCHA_SECRET_KEY (dev fallback: both open).

import { useEffect, useRef, useState, useCallback } from "react";

interface WindowWithGrecaptcha extends Window {
  grecaptcha?: {
    ready: (cb: () => void) => void;
    execute: (siteKey: string, opts: { action: string }) => Promise<string>;
  };
}

const SCRIPT_ID = "google-recaptcha-v3";

function loadScript(siteKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();
    if (document.getElementById(SCRIPT_ID)) return resolve();
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load reCAPTCHA script"));
    document.head.appendChild(s);
  });
}

/**
 * Ensures the reCAPTCHA v3 script is loaded and returns an execute() fn.
 * `execute(action)` returns a token string (empty on failure / no key).
 */
export function useRecaptcha() {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!siteKey) {
      // No key configured — degrade gracefully. Server-side helper does
      // the same on the verify side.
      setReady(true);
      return () => {
        mountedRef.current = false;
      };
    }
    loadScript(siteKey)
      .then(() => {
        if (!mountedRef.current) return;
        setReady(true);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setError(err?.message || "Failed to load reCAPTCHA");
        setReady(true); // still let the form submit — server decides
      });
    return () => {
      mountedRef.current = false;
    };
  }, [siteKey]);

  const execute = useCallback(
    async (action: string): Promise<string> => {
      if (!siteKey) return "";
      const w = window as WindowWithGrecaptcha;
      if (!w.grecaptcha) return "";
      return new Promise<string>((resolve) => {
        w.grecaptcha!.ready(async () => {
          try {
            const token = await w.grecaptcha!.execute(siteKey, { action });
            resolve(token);
          } catch (err) {
            console.warn("[useRecaptcha] execute failed:", err);
            resolve("");
          }
        });
      });
    },
    [siteKey]
  );

  return { ready, error, execute };
}
