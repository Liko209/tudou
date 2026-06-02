/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Each route exports to a depth-0 file (`/` → index.html, `/tray` → tray.html)
  // so the relative `assetPrefix: './'` (_next/…) resolves under file:// for
  // EVERY page, including the menu-bar popover route. (true → tray/index.html,
  // whose `./_next` would point at a nonexistent tray/_next under file://.)
  trailingSlash: false,
  images: { unoptimized: true },
  // Electron loads via file:// in production — make all asset URLs relative.
  assetPrefix: process.env.NODE_ENV === 'production' ? './' : undefined,
  reactStrictMode: true,
  typescript: {
    // We run typecheck separately via tsc; let Next.js report fast.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
