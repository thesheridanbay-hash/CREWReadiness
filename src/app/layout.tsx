import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";

import { ExitModal } from "@/shared/components/modals/exit-modal";
import { PracticeModal } from "@/shared/components/modals/practice-modal";
import { Toaster } from "@/shared/ui/sonner";
import { cn } from "@/shared/utils";
import { siteConfig } from "@/shared/config";

import "./globals.css";

/**
 * Cross-brand type system (CrewYield family): Hanken Grotesk for UI/body,
 * Fraunces for editorial display titles, IBM Plex Mono for figures. Self-hosted
 * by next/font at build time (no runtime Google fetch). Exposed as CSS vars and
 * wired to Tailwind's font-sans / font-display / font-mono.
 */
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#1f4131",
};

export const metadata: Metadata = siteConfig;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={cn(sans.variable, display.variable, mono.variable, "font-sans")}
      >
        <Toaster theme="light" richColors closeButton />
        <ExitModal />
        <PracticeModal />
        {children}
      </body>
    </html>
  );
}
