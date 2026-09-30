import type { Metadata } from "next";
import { buildPartnerMetadata } from "@/lib/partner-metadata";

export async function generateMetadata(): Promise<Metadata> {
  return buildPartnerMetadata({
    pageTitle: "About Us",
    pageDescription:
      "Built by operators, for operators. Learn how our all-in-one POS, payments, and reservations platform helps modern businesses run smoother.",
    pathname: "/about",
  });
}

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
