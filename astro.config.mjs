// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  redirects: {
    "/": "/about",
  },
  vite: {
    plugins: [tailwindcss(), mdx(), sitemap()],
  },
});
