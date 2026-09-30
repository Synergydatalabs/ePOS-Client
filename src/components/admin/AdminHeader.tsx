"use client";

import { Icon } from "@iconify/react";
import { useSession } from "next-auth/react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

interface AdminHeaderProps {
  title: string;
  // Widened to ReactNode so pages can pass JSX (breadcrumbs, badges, etc.)
  // instead of just plain text. Backwards-compatible — a string is a valid
  // ReactNode. Every existing caller keeps working unchanged.
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function AdminHeader({ title, subtitle, actions }: AdminHeaderProps) {
  const { data: session } = useSession();

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-4">
          {/* Actions */}
          {actions && <div className="flex items-center gap-2">{actions}</div>}

          {/* Language switcher — EN/FR flip for the whole tree */}
          <LanguageSwitcher />

          {/* Notifications */}
          <button className="relative p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <Icon icon="solar:bell-linear" className="w-6 h-6 text-gray-600" />
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
          </button>

          {/* User Menu — PHASE 7a (2026-05-18): avatar tile uses --brand-primary
              CSS var so it picks up partner branding when on a partner domain.
              Falls back to teal so the standard iTap look is preserved. */}
          <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
              style={{ backgroundColor: "var(--brand-primary, #14b8a6)" }}
            >
              <span>
                {session?.user?.email?.[0]?.toUpperCase() || "U"}
              </span>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-gray-900 truncate max-w-[150px]">
                {session?.user?.email || "User"}
              </p>
              <p className="text-xs text-gray-500">Administrator</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
