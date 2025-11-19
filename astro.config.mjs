import tailwindcss from "@tailwindcss/vite";
// @ts-check
import { defineConfig } from "astro/config";

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
		"/christmas-list/2025":
			"https://acidic-owner-5a8.notion.site/Alex-s-Christmas-List-2025-2a99905e01ff80f584acf711524520af",
	},

	vite: {
		plugins: [tailwindcss(), mdx(), sitemap()],
	},

	adapter: cloudflare(),
});

