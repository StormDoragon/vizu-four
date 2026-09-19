import type { Metadata } from "next";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Actions Visual Debugger",
  description: "Visual, AI-assisted step-through debugger for GitHub Actions workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Sets data-theme from localStorage before hydration, so a returning
         * light-mode visitor never sees a dark flash. Dark needs no attribute
         * (it's the :root default in globals.css), so this only ever acts on
         * a stored "light" preference. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-bg font-sans antialiased">{children}</body>
    </html>
  );
}
