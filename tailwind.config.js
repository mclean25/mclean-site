/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        oswald: "var(--font-oswald)",
      },
      colors: {
        background: "var(--color-background)",
        text: "var(--color-text)",
        muted: "var(--color-text-muted)",
        link: "var(--color-link)",
      },
      textColor: {
        primary: "var(--color-text)",
        secondary: "var(--color-text-muted)",
        link: "var(--color-link)",
      },
      backgroundColor: {
        primary: "var(--color-background)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
