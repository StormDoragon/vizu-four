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
          pending: "#484f58",
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
