// Minimalist footer for the public booking flow. Salon merchants sell
// this booking page as their own — no third-party branding.

export default function BookingFooter({ poweredBy = true }: { poweredBy?: boolean }) {
  if (!poweredBy) return null;
  return (
    <footer className="border-t border-gray-100 py-6 mt-12">
      <div className="max-w-5xl mx-auto px-4 text-center text-xs text-gray-400">
        &nbsp;
      </div>
    </footer>
  );
}
