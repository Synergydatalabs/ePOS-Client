"use client";

import { useEffect, useRef } from "react";

// Global keyboard-wedge barcode scanner listener.
//
// How USB HID scanners work: they masquerade as a keyboard, "typing" the
// barcode's characters in rapid succession (typically < 20 ms between
// chars) and pressing Enter (or Tab, configurable on most models) at the
// end. Human typing is at least 5–10× slower, so we distinguish the two
// by measuring the time between successive keystrokes:
//
//   - Buffer printable chars.
//   - If more than SCAN_MAX_INTERVAL_MS passes between chars, reset the
//     buffer (that was a human typing).
//   - When Enter/Tab arrives, if the buffer is long enough AND arrived
//     fast enough, emit it as a scan.
//
// Because we listen at document level and only fire on the fast-burst
// pattern, users can still type into inputs normally — including the
// search bar and modals — without accidentally triggering a scan.

const SCAN_MAX_INTERVAL_MS = 40; // max gap between chars for a burst
const SCAN_MIN_LENGTH = 4; // ignore very short bursts (single-key errors)
const SCAN_MAX_LENGTH = 64; // sanity cap; real barcodes fit inside this

interface Options {
  /** Called with the scanned string when a scan is detected. */
  onScan: (code: string) => void;
  /**
   * When false, the listener is inert. Handy so you can pause scanning
   * while a full-screen modal (e.g. Payment) is open.
   */
  enabled?: boolean;
}

export function useBarcodeScanner({ onScan, enabled = true }: Options) {
  // Refs, not state — updating state on every keystroke would rerender
  // the whole POS at scanner speed.
  const bufferRef = useRef<string>("");
  const lastKeyAtRef = useRef<number>(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      const now = performance.now();
      const delta = now - lastKeyAtRef.current;
      lastKeyAtRef.current = now;

      // Terminator: commit the buffer if it looks like a scan.
      if (e.key === "Enter" || e.key === "Tab") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= SCAN_MIN_LENGTH) {
          // Prevent the Enter from also submitting an open form when the
          // scan is the real intent. If the user genuinely pressed Enter
          // to submit, they wouldn't have a big buffer sitting there.
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      // Ignore modifier-only keys and non-printable keys (arrows, F-keys)
      if (e.key.length !== 1) {
        bufferRef.current = "";
        return;
      }

      // Fresh burst: reset the buffer to just this char.
      if (delta > SCAN_MAX_INTERVAL_MS) {
        bufferRef.current = e.key;
        return;
      }

      // Continuation of a burst.
      bufferRef.current += e.key;
      if (bufferRef.current.length > SCAN_MAX_LENGTH) {
        bufferRef.current = ""; // runaway — probably not a scan
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled]);
}
