import type { Metadata } from "next";
import { buildPartnerMetadata } from "@/lib/partner-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "Sign Up — Start Free Trial",
    pageDescription:
      "Create your account in under a minute. No credit card required, no setup fee, cancel anytime.",
    pathname: "/signup",
    index: false, // auth page — don't index
  });
}

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
