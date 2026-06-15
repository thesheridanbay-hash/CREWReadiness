import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Cross-brand (CrewYield family) semantic brand colors. The migrated
           brand spots use these instead of raw green-/sky-/teal- utilities; a
           future re-skin edits this block + the :root neutrals. See DESIGN.md.
           Discipline: `gold` is the single accent (primary action / AI / streaks),
           one per view; `brand` (pine) is structural chrome; `success` (green) is
           correct/progress; `danger` is wrong/destructive. */
        brand: {
          DEFAULT: "#1f4131",
          50: "#e7efe7",
          500: "#2c5a43",
          600: "#1f4131",
          700: "#16321e",
          800: "#0f2419",
          900: "#0c1d14",
        },
        gold: {
          DEFAULT: "#c8881f",
          50: "#f6ebd3",
          500: "#c8881f",
          700: "#9a6710",
        },
        success: {
          DEFAULT: "#2f7d4f",
          50: "#e3f0e6",
          500: "#2f7d4f",
          600: "#2f7d4f",
          700: "#256340",
        },
        danger: {
          DEFAULT: "#b23a2d",
          50: "#f6e1dc",
          500: "#b23a2d",
          600: "#9a3226",
        },
        canvas: {
          DEFAULT: "#f6f4ec",
          2: "#efece1",
        },
        surface: "#fffdf7",
        ink: {
          DEFAULT: "#16201a",
          2: "#3f4a42",
          3: "#6b756c",
        },
        line: {
          DEFAULT: "#ddd7c7",
          2: "#cbc4b0",
        },
        info: "#3a5a8c",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindAnimate],
} satisfies Config;

export default config;
