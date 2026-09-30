import type { Metadata } from "next";
import { buildPartnerMetadata } from "@/lib/partner-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "Cookie Policy",
    pageDescription:
      "How we use cookies on this site to keep you signed in, remember your preferences, and improve performance.",
    pathname: "/cookies",
  });
}

export default function CookiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
