import Link from "next/link";
import { Icon } from "@iconify/react/dist/iconify.js";

export default function BookingNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <Icon icon="solar:moon-sleep-bold" className="w-9 h-9 text-gray-400" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          That booking page isn't available
        </h1>
        <p className="text-gray-600 mb-6">
          The restaurant link may have moved, or online booking is paused for
          this location. Try contacting them directly.
        </p>
        <Link
          href="https://zashx.com"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Visit zashx.com
          <Icon icon="solar:arrow-right-bold" className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
