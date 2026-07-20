import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ivory: "#fef8f6",
        espresso: "#2d241e",
        sage: "#566f60",
        terracotta: "#d17a5d",
      },
      fontFamily: {
        heading: ["EB Garamond", "Georgia", "serif"],
        body: ["Hanken Grotesk", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "24px",
      },
      minHeight: {
        touch: "48px",
      },
    },
  },
  plugins: [],
} satisfies Config;
