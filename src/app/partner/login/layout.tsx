import type { Metadata } from "next";
import { buildPartnerMetadata } from "@/lib/partner-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "Login",
    pageDescription:
      "Sign in to your dashboard to manage orders, payments, and reservations.",
    pathname: "/login",
    index: false, // auth page — don't index
  });
}

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
