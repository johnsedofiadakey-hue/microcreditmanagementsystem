import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @susu/shared is consumed as TypeScript source (see root CLAUDE.md).
  transpilePackages: ['@susu/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
