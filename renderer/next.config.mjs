/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
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
