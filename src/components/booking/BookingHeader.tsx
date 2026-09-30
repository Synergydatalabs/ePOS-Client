"use client";

// Brand-aware header for the public booking pages.
// Shows tenant logo (or name) + an optional "Back" link.

import Link from "next/link";
import { Icon } from "@iconify/react";

interface Props {
  tenantName: string;
  logoUrl?: string | null;
  brandPrimaryColor?: string | null;
  backHref?: string;
  backLabel?: string;
}

export default function BookingHeader({
  tenantName,
  logoUrl,
  brandPrimaryColor,
  backHref,
  backLabel = "Back",
}: Props) {
  return (
    <header
      className="bg-white border-b border-gray-200 sticky top-0 z-30"
      style={brandPrimaryColor ? { borderBottomColor: `${brandPrimaryColor}20` } : {}}
    >
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {backHref && (
            <Link
              href={backHref}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label={backLabel}
            >
              <Icon icon="solar:arrow-left-bold" className="w-5 h-5 text-gray-700" />
            </Link>
          )}
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={tenantName} className="h-9 object-contain" />
          ) : (
            <h1 className="text-lg font-bold text-gray-900">{tenantName}</h1>
          )}
        </div>
        <div className="text-xs text-gray-400 hidden sm:block">
          Reservations
        </div>
      </div>
    </header>
  );
}
