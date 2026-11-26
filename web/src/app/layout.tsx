import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"] });
const sourceSans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "rideNtrack: group motorcycle rides, planned and tracked", template: "%s · rideNtrack" },
  description: "Plan motorcycle trips, ride together and let family follow along. Built for riders in India.",
};

export const viewport: Viewport = { themeColor: "#060607", colorScheme: "dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${sourceSans.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
