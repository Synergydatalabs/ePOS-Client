"use client";

import { usePathname } from "next/navigation";

export default function DriveLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Driver portal has its own layout, don't wrap it
  const isDriverPortal = pathname.startsWith("/drive/driver");

  if (isDriverPortal) {
    return <>{children}</>;
  }

  // Customer-facing layout
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">iT</span>
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm leading-tight">iTAP Ride</h1>
            <p className="text-[10px] text-gray-500 leading-tight">Book a Ride</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-100 py-4 text-center">
        <p className="text-gray-400 text-xs">
          Powered by <span className="font-semibold text-gray-500">iTAP</span>
        </p>
      </footer>
    </div>
  );
}
