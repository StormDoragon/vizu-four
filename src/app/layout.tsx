import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Actions Visual Debugger",
  description: "Visual, AI-assisted step-through debugger for GitHub Actions workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg font-sans antialiased">{children}</body>
    </html>
  );
}
