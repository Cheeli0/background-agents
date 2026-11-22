import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/**
 * `next dev` and `next build` still work. For Cloudflare, vinext builds the same app
 * through `vite.config.ts` and `cloudflare.config.ts` (`npm run build:vinext`).
 * Turbopack finds the monorepo root on its own from the root `package-lock.json`.
 *
 * @type {import("next").NextConfig}
 */
const config = {
  reactStrictMode: true,
};

export default withMDX(config);
