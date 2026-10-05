import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StayLiquid Backend API",
  description: "StayLiquid Solana automated savings and payout infrastructure",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
