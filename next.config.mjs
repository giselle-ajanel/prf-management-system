/** @type {import("next").NextConfig} */
// distDir is overridable so a verification build can run without disturbing a dev server that is using
// .next at the same time — the two write different chunk names into the same folder otherwise.
const nextConfig = { distDir: process.env.NEXT_DIST_DIR || ".next" };
export default nextConfig;
