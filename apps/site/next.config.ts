import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @susu/shared is consumed as TypeScript source (see root CLAUDE.md).
  transpilePackages: ['@susu/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  // Every page is static: `next build` writes apps/site/out for Firebase Hosting (target `site`).
  output: 'export',
  trailingSlash: true,
};

export default nextConfig;
