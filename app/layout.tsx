import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "team-18 · Platanus Hack 26",
  description: "Proyecto del track Legacy — Platanus Hack 26 CDMX",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
