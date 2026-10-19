import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @susu/shared is consumed as TypeScript source (see root CLAUDE.md).
  transpilePackages: ['@susu/shared'],
  reactStrictMode: true,
  poweredByHeader: false,
  // dev/build run with --webpack: Turbopack does not map @susu/shared's ".js" specifiers to ".ts"
  // sources inside a transpiled workspace package (see docs/audit/AUDIT-2026-10-18.md).
  webpack: (config) => {
    // @susu/shared uses NodeNext-style ".js" specifiers that point at ".ts" files.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
