import type { Metadata } from "next";
import { buildPartnerMetadata } from "@/lib/partner-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "Terms & Conditions",
    pageDescription:
      "The terms of service that govern use of our point of sale and payments platform.",
    pathname: "/terms",
  });
}

export default function TermsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
