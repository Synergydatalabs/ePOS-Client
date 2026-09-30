import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dash Rides — Book Your Ride",
  description: "Fast, reliable rides at your fingertips",
};

export default function RideLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
