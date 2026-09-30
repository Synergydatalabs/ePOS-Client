import type { Metadata } from "next";
import { buildPartnerMetadata } from "@/lib/partner-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "Privacy Policy",
    pageDescription:
      "How we collect, use, and protect your data when you use our point of sale and payments platform.",
    pathname: "/privacy",
  });
}

export default function PrivacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
