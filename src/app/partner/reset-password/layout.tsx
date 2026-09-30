import type { Metadata } from "next";
import { buildPartnerMetadata } from "@/lib/partner-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "Reset Password",
    pageDescription:
      "Reset the password on your account. Enter your email and we'll send you a secure reset link.",
    pathname: "/reset-password",
    index: false, // auth page — don't index
  });
}

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
