"use client";

import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useT, type Locale } from "@/lib/i18n/context";

// Compact language switcher for headers. Shows the current locale's short
// code and opens a dropdown with the full names. Closes on outside click
// so it doesn't linger when the user moves on.
export default function LanguageSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { locale, setLocale, t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const options: { code: Locale; short: string; labelKey: string }[] = [
    { code: "en", short: "EN", labelKey: "language.en" },
    { code: "fr", short: "FR", labelKey: "language.fr" },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors ${
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
        title={t("common.language", { defaultValue: "Language" })}
      >
        <Icon icon="solar:global-linear" className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
        <span className="font-medium">
          {locale.toUpperCase()}
        </span>
        <Icon icon="solar:alt-arrow-down-linear" className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded-xl border border-gray-100 bg-white shadow-lg z-50 overflow-hidden">
          {options.map((o) => (
            <button
              key={o.code}
              onClick={() => {
                setLocale(o.code);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                locale === o.code
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-700"
              }`}
            >
              <span>{t(o.labelKey)}</span>
              {locale === o.code && (
                <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
