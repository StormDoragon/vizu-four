import type { Config } from "tailwindcss";

// Every color below resolves through a CSS custom property (see
// globals.css), not a fixed hex - `rgb(var(--x) / <alpha-value>)` is the
// standard Tailwind pattern for a color that can vary per theme while
// still supporting opacity utilities (`bg-status-success/20`, etc., which
// this codebase uses heavily). `:root` in globals.css holds the dark
// values (dark is the app's original, unchanged default - no attribute
// needed) and `[data-theme="light"]` overrides them.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "rgb(var(--bg) / <alpha-value>)",
          panel: "rgb(var(--bg-panel) / <alpha-value>)",
          raised: "rgb(var(--bg-raised) / <alpha-value>)",
          border: "rgb(var(--bg-border) / <alpha-value>)",
        },
        status: {
          success: "rgb(var(--status-success) / <alpha-value>)",
          failure: "rgb(var(--status-failure) / <alpha-value>)",
          skipped: "rgb(var(--status-skipped) / <alpha-value>)",
          running: "rgb(var(--status-running) / <alpha-value>)",
          pending: "rgb(var(--status-pending) / <alpha-value>)",
          breakpoint: "rgb(var(--status-breakpoint) / <alpha-value>)",
        },
        // Replaces raw `text-gray-N`/`text-white`/`border-gray-N` usage
        // throughout the app. Lower numbers stay "more prominent" in both
        // themes, the way the app already used them (text-gray-100 for
        // near-heading emphasis, text-gray-600 for the faintest read-only
        // text) - only the underlying RGB flips direction, since
        // "prominent" against a dark panel means literally light, and
        // against a light panel means literally dark. `ink-700` is a
        // background-only tier (a subtle chip fill), never text.
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
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
