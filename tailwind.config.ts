import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0b0e14",
          panel: "#11151d",
          raised: "#171c26",
          border: "#232a37",
        },
        status: {
          success: "#3fb950",
          failure: "#f85149",
          skipped: "#8b949e",
          running: "#58a6ff",
          // #484f58 (the original value) contrasts at ~2.2:1 against every
          // panel background in this theme - below even the 3:1 WCAG
          // non-text minimum for a UI graphic, so a "pending" dot was
          // nearly invisible. #9aa4b2 clears 7:1 against all three
          // backgrounds (bg, bg-panel, bg-raised) and reads lighter than
          // "skipped" (#8b949e), which is deliberate: pending is rendered
          // as a hollow ring rather than a filled dot (see statusStyles.ts)
          // so the two neutral states are told apart by shape as well as
          // shade, not by color alone.
          pending: "#9aa4b2",
          breakpoint: "#d29922",
        },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
