"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@iconify/react";

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      router.push("/signin");
      return;
    }

    // Check if user has POS access
    if ((session as any).hasPosAccess) {
      router.push("/dashboard");
    } else {
      router.push("/activate");
    }
  }, [session, status, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-600 to-cyan-600">
      <div className="text-center text-white">
        <div className="animate-pulse-slow mb-4">
          <Icon icon="solar:point-on-map-bold" className="w-16 h-16 mx-auto" />
        </div>
        <h1 className="text-2xl font-bold mb-2">iTAP</h1>
        <p className="text-teal-100">Loading...</p>
      </div>
    </div>
  );
}
