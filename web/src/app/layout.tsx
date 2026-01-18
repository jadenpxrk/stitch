import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stitch",
  description: "Stitch — AI-first video editor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className="dark" lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
