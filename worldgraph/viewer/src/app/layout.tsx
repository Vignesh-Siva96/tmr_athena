import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Worldgraph — TMR Support Platform",
  description: "Zoomable map + storyboard of the TMR Support Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
