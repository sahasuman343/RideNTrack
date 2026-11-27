import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// Fraunces is self-hosted as trimmed static cuts (see src/fonts/README.md): about a third of the bytes of the variable font.
const frauncesDisplay = localFont({
  src: [
    { path: "../fonts/fraunces-display.woff2", weight: "600", style: "normal" },
    { path: "../fonts/fraunces-display-italic.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-fraunces-display",
  fallback: ["Georgia", "serif"],
});
const fraunces = localFont({ src: "../fonts/fraunces-text.woff2", weight: "600", variable: "--font-fraunces", fallback: ["Georgia", "serif"] });
const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://ridentrack.app"),
  title: { default: "rideNtrack: group motorcycle rides, planned and tracked", template: "%s · rideNtrack" },
  description: "Plan motorcycle trips, ride together and let family follow along. Built for riders in India.",
};

export const viewport: Viewport = { themeColor: "#060607", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${frauncesDisplay.variable} ${sourceSans.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
