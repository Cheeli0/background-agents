import { defineConfig } from "vite";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // Tailwind runs as a Vite plugin here; postcss.config.mjs only serves `next dev`/`next build`.
  css: { postcss: {} },
  plugins: [
    mdx(),
    tailwindcss(),
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
