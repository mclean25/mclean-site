// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  devToolbar: {
    enabled: false,
  },

  redirects: {
    "/": "/about",
  },

  vite: {
    plugins: [tailwindcss(), mdx(), sitemap()],
  },

  adapter: cloudflare(),
});