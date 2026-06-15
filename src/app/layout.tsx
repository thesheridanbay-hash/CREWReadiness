import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { ExitModal } from "@/shared/components/modals/exit-modal";
import { PracticeModal } from "@/shared/components/modals/practice-modal";
import { Toaster } from "@/shared/ui/sonner";
import { siteConfig } from "@/shared/config";

import "./globals.css";

/**
 * Self-hosted Nunito variable font (latin + latin-ext for EN/ES content):
 * deterministic builds with no Google Fonts fetch at build time.
 */
const font = localFont({
  src: [
    { path: "./fonts/nunito-latin.woff2" },
    { path: "./fonts/nunito-latin-ext.woff2" },
  ],
  weight: "200 1000",
  style: "normal",
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
      <body className={font.className}>
        <Toaster theme="light" richColors closeButton />
        <ExitModal />
        <PracticeModal />
        {children}
      </body>
    </html>
  );
}
