import type { Metadata } from "next";
import {
  Geist_Mono,
  IBM_Plex_Sans,
  Libre_Baskerville,
  Source_Serif_4,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const libreBaskerville = Libre_Baskerville({
  variable: "--font-libre-baskerville",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// System / terminal voice. Drives the "reference terminal" chrome and HUD labels.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "readabook | reference terminal",
  description: "Turn YouTube transcripts into cozy books for your private shelf.",
  icons: {
    icon: "/convex.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${ibmPlexSans.variable} ${libreBaskerville.variable} ${sourceSerif.variable} ${geistMono.variable} ${spaceGrotesk.variable} antialiased`}
      >
        <ClerkProvider
          dynamic
          appearance={{
            baseTheme: shadcn,
            variables: {
              borderRadius: "0rem",
              colorPrimary: "oklch(0.43 0.105 142)",
              colorBackground: "oklch(0.99 0.018 88)",
              colorText: "oklch(0.24 0.045 76)",
            },
          }}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
