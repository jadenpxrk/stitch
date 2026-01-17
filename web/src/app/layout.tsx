import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overshoot Auto-Editor",
  description: "CUT / STABILIZE / BRIDGE with Overshoot + Veo",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
